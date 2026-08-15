/**
 * Finds meeting slots across participants.
 *
 * The search is a straightforward sweep: step a candidate window across the
 * requested range and, at each position, collect everyone who is free for the
 * whole duration. Cleverness here would buy nothing - a week at 15-minute
 * granularity is a few hundred positions - and the sweep has the useful property
 * that partial matches fall out of the same pass as full ones, which is what the
 * no-match fallback is built from.
 */

import { DateTime } from "luxon";
import { containsRange } from "./intervals";
import { describeParticipantSlot, freeIntervals } from "./availability";
import type { Instant, Interval, Participant, Slot } from "./types";

const MINUTE = 60_000;

/** How central a slot sits within someone's day before it stops mattering. */
const COMFORT_CAP_MINUTES = 60;

/** One sweep position: a start time and the participants free for the full duration. */
interface Candidate {
  start: Instant;
  attendeeIds: string[];
  key: string;
}

/** Consecutive candidates sharing an identical attendee set, collapsed into one range. */
export interface CandidateRun {
  firstStart: Instant;
  lastStart: Instant;
  attendeeIds: string[];
  /**
   * Where within the run the meeting should actually be placed. Set during
   * ranking; falls back to `firstStart` when a run is built outside that path.
   */
  recommendedStart?: Instant;
}

export interface SweepResult {
  runs: CandidateRun[];
  freeByParticipant: Map<string, Interval[]>;
}

/**
 * Walk the range and record who is free at each candidate position.
 *
 * Availability is resolved once per participant up front rather than per
 * position, so the sweep itself is only interval containment checks.
 */
export function sweep(
  participants: Participant[],
  range: Interval,
  durationMs: number,
  granularityMs: number,
): SweepResult {
  const freeByParticipant = new Map<string, Interval[]>();
  for (const participant of participants) {
    freeByParticipant.set(participant.id, freeIntervals(participant, range));
  }

  const candidates: Candidate[] = [];
  for (let start = range.start; start + durationMs <= range.end; start += granularityMs) {
    const end = start + durationMs;
    const attendeeIds = participants
      .filter((p) => containsRange(freeByParticipant.get(p.id) ?? [], start, end))
      .map((p) => p.id);

    if (attendeeIds.length > 0) {
      candidates.push({ start, attendeeIds, key: attendeeIds.join("|") });
    }
  }

  return { runs: mergeRuns(candidates, granularityMs), freeByParticipant };
}

/**
 * Collapse consecutive candidates with the same attendees into a single run.
 *
 * Without this, a four-hour window at 15-minute granularity produces sixteen
 * near-identical results differing only by start time. One row reading
 * "13:00-17:00, Tom + Sara" is what a coordinator can actually use.
 */
function mergeRuns(candidates: Candidate[], granularityMs: number): CandidateRun[] {
  const runs: CandidateRun[] = [];

  for (const candidate of candidates) {
    const previous = runs[runs.length - 1];
    const continuous =
      previous &&
      previous.attendeeIds.join("|") === candidate.key &&
      candidate.start - previous.lastStart <= granularityMs;

    if (continuous) {
      previous.lastStart = candidate.start;
    } else {
      runs.push({
        firstStart: candidate.start,
        lastStart: candidate.start,
        attendeeIds: [...candidate.attendeeIds],
      });
    }
  }

  return runs;
}

/**
 * Score how comfortable a slot is for the people attending it.
 *
 * Slots pressed against the start or end of someone's day are technically valid
 * but nobody wants the meeting that begins one minute before they log off, so
 * runs with more room either side rank higher. Each participant's contribution is
 * capped, so one very central attendee cannot outweigh another sitting on an edge.
 */
function comfortScore(
  attendeeIds: string[],
  start: Instant,
  end: Instant,
  freeByParticipant: Map<string, Interval[]>,
): number {
  let total = 0;

  for (const id of attendeeIds) {
    const windows = freeByParticipant.get(id) ?? [];
    const window = windows.find((w) => w.start <= start && w.end >= end);
    if (!window) continue;

    const marginBefore = (start - window.start) / MINUTE;
    const marginAfter = (window.end - end) / MINUTE;
    total += Math.min(Math.min(marginBefore, marginAfter), COMFORT_CAP_MINUTES);
  }

  return total;
}

/**
 * Choose where inside a run to actually place the meeting.
 *
 * A run is a range of equally valid start times, and taking the earliest reliably
 * produces the worst one: it sits flush against the opening of somebody's day.
 * For the brief's data that means recommending Maya's first 45 minutes of the
 * morning when the same run offers a far more civilised time an hour later.
 * Scanning the run for the highest comfort score costs nothing at these sizes.
 */
export function pickRecommendedStart(
  run: CandidateRun,
  durationMs: number,
  granularityMs: number,
  freeByParticipant: Map<string, Interval[]>,
): Instant {
  let best = run.firstStart;
  let bestScore = -Infinity;

  for (let start = run.firstStart; start <= run.lastStart; start += granularityMs) {
    const score = comfortScore(run.attendeeIds, start, start + durationMs, freeByParticipant);
    // Strictly greater keeps the earliest of equally comfortable positions.
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }

  return best;
}

/** A representative option together with the other dates it recurs on. */
export interface RunGroup {
  representative: CandidateRun;
  repeatDates: string[];
}

/**
 * Collapse options that recur identically on other days.
 *
 * Working hours repeat every weekday, so a week's search returns the same handful
 * of options once per day - fifteen results covering three actual choices for the
 * team in the brief. Grouping by attendees and time of day reduces that to the
 * three real options, each carrying the dates it also applies to.
 *
 * Time of day is part of the key deliberately. If a daylight-saving change moves
 * an option to a different UTC time midway through the range, it is genuinely a
 * different option and stays a separate result rather than being folded into a
 * list of dates that would misstate when it happens.
 */
export function collapseRepeats(runs: CandidateRun[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();

  for (const run of runs) {
    const start = run.recommendedStart ?? run.firstStart;
    const at = DateTime.fromMillis(start, { zone: "utc" });
    const key = `${run.attendeeIds.join("|")}@${at.toFormat("HH:mm")}`;

    const existing = groups.get(key);
    if (existing) {
      // Runs arrive ranked, so the first occurrence is the best-timed one and
      // later days become repeats of it.
      existing.repeatDates.push(at.toISODate() ?? "");
    } else {
      groups.set(key, { representative: run, repeatDates: [] });
    }
  }

  return [...groups.values()];
}

/** Turn a run into an API-facing slot, resolved into every participant's local time. */
export function toSlot(
  run: CandidateRun,
  participants: Participant[],
  durationMs: number,
  repeatsOn: string[] = [],
): Slot {
  const start = run.recommendedStart ?? run.firstStart;
  const end = start + durationMs;
  const attending = new Set(run.attendeeIds);

  return {
    startUtc: DateTime.fromMillis(start, { zone: "utc" }).toISO() ?? "",
    endUtc: DateTime.fromMillis(end, { zone: "utc" }).toISO() ?? "",
    earliestStartUtc: DateTime.fromMillis(run.firstStart, { zone: "utc" }).toISO() ?? "",
    latestStartUtc: DateTime.fromMillis(run.lastStart, { zone: "utc" }).toISO() ?? "",
    attendeeCount: run.attendeeIds.length,
    totalParticipants: participants.length,
    isFullMatch: run.attendeeIds.length === participants.length,
    // Everyone is described, not just attendees - the coordinator needs to see
    // who is missing and why, which is the whole point when nothing fits.
    participants: participants.map((p) =>
      describeParticipantSlot(p, start, end, attending.has(p.id)),
    ),
    repeatsOn,
  };
}

/**
 * Rank runs: most attendees first, then most comfortable, then earliest.
 *
 * Coverage dominates because a meeting more people can attend is more useful
 * regardless of how pleasant its timing is.
 */
export function rankRuns(
  runs: CandidateRun[],
  durationMs: number,
  granularityMs: number,
  freeByParticipant: Map<string, Interval[]>,
): CandidateRun[] {
  // Each run is scored at the position it would actually be booked at, so ranking
  // and recommendation agree rather than judging a time nobody would be offered.
  const resolved = runs.map((run) => ({
    ...run,
    recommendedStart: pickRecommendedStart(run, durationMs, granularityMs, freeByParticipant),
  }));

  return resolved.sort((a, b) => {
    if (a.attendeeIds.length !== b.attendeeIds.length) {
      return b.attendeeIds.length - a.attendeeIds.length;
    }

    const comfortA = comfortScore(a.attendeeIds, a.recommendedStart, a.recommendedStart + durationMs, freeByParticipant);
    const comfortB = comfortScore(b.attendeeIds, b.recommendedStart, b.recommendedStart + durationMs, freeByParticipant);
    if (comfortA !== comfortB) return comfortB - comfortA;

    return a.firstStart - b.firstStart;
  });
}
