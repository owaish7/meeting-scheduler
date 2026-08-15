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

/** Turn a run into an API-facing slot, resolved into every participant's local time. */
export function toSlot(
  run: CandidateRun,
  participants: Participant[],
  durationMs: number,
): Slot {
  const start = run.firstStart;
  const end = start + durationMs;
  const attending = new Set(run.attendeeIds);

  return {
    startUtc: DateTime.fromMillis(start, { zone: "utc" }).toISO() ?? "",
    endUtc: DateTime.fromMillis(end, { zone: "utc" }).toISO() ?? "",
    latestStartUtc: DateTime.fromMillis(run.lastStart, { zone: "utc" }).toISO() ?? "",
    attendeeCount: run.attendeeIds.length,
    totalParticipants: participants.length,
    isFullMatch: run.attendeeIds.length === participants.length,
    // Everyone is described, not just attendees - the coordinator needs to see
    // who is missing and why, which is the whole point when nothing fits.
    participants: participants.map((p) =>
      describeParticipantSlot(p, start, end, attending.has(p.id)),
    ),
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
  freeByParticipant: Map<string, Interval[]>,
): CandidateRun[] {
  return [...runs].sort((a, b) => {
    if (a.attendeeIds.length !== b.attendeeIds.length) {
      return b.attendeeIds.length - a.attendeeIds.length;
    }

    const comfortA = comfortScore(a.attendeeIds, a.firstStart, a.firstStart + durationMs, freeByParticipant);
    const comfortB = comfortScore(b.attendeeIds, b.firstStart, b.firstStart + durationMs, freeByParticipant);
    if (comfortA !== comfortB) return comfortB - comfortA;

    return a.firstStart - b.firstStart;
  });
}
