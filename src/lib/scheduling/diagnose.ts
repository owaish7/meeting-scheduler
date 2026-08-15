/**
 * What to say when the group cannot meet.
 *
 * For the dataset in the brief there is no 45-minute slot covering all four
 * people on any day, so returning an empty list would be correct and useless.
 * This module turns "no" into something a coordinator can act on: the best
 * partial options, a set of meetings that covers everyone without anyone working
 * outside their hours, and a plain explanation of what is blocking the group.
 */

import { DateTime } from "luxon";
import { intersect } from "./intervals";
import { expandWorkingHours, freeIntervals } from "./availability";
import { toSlot, type CandidateRun } from "./solver";
import type {
  BlockingPair,
  Diagnosis,
  ForcedOption,
  Instant,
  Interval,
  Participant,
  SplitMeeting,
  SplitPlan,
} from "./types";

const MINUTE = 60_000;

/** Above this, exact cover stops being cheap and the greedy answer is used instead. */
const EXACT_COVER_PARTICIPANT_LIMIT = 16;

/**
 * Reduce runs to one representative per distinct attendee set.
 *
 * Fifteen runs across a week collapse to three distinct groupings, which is what
 * the cover search actually operates on. Runs arrive ranked, so the first
 * occurrence of a set is already its best-timed instance.
 */
function distinctByAttendeeSet(runs: CandidateRun[], index: Map<string, number>) {
  const byMask = new Map<number, CandidateRun>();

  for (const run of runs) {
    let mask = 0;
    for (const id of run.attendeeIds) {
      const bit = index.get(id);
      if (bit !== undefined) mask |= 1 << bit;
    }
    if (mask !== 0 && !byMask.has(mask)) byMask.set(mask, run);
  }

  return byMask;
}

/**
 * Cover everyone with as few meetings as possible, nobody outside their hours.
 *
 * This is set cover. The textbook answer is the greedy approximation, but greedy
 * gets the brief's own dataset wrong: it takes Maya + Tom first because that set
 * looks as good as any other, then needs two further meetings for Sara and Jack,
 * who cannot share one. Three meetings where two suffice.
 *
 * Since the distinct attendee sets number in the handful, a breadth-first search
 * over covered-participant bitmasks finds a genuinely minimal plan at negligible
 * cost. Breadth-first means the first complete cover reached is minimal, so the
 * two-meeting answer comes out reliably rather than by luck of ordering.
 */
export function buildSplitPlan(
  runs: CandidateRun[],
  participants: Participant[],
  durationMs: number,
): SplitPlan | undefined {
  if (runs.length === 0) return undefined;

  const index = new Map(participants.map((p, i) => [p.id, i]));
  const byMask = distinctByAttendeeSet(runs, index);
  if (byMask.size === 0) return undefined;

  const options = [...byMask.keys()];
  // Anyone with no availability anywhere cannot be covered, so the target is the
  // union of what is actually reachable rather than the whole group.
  const target = options.reduce((acc, mask) => acc | mask, 0);

  const chosen =
    participants.length <= EXACT_COVER_PARTICIPANT_LIMIT
      ? minimalCover(options, target)
      : greedyCover(options, target);

  const meetings: SplitMeeting[] = chosen.map((mask) => {
    const run = byMask.get(mask)!;
    return { slot: toSlot(run, participants, durationMs), attendeeIds: [...run.attendeeIds] };
  });

  if (meetings.length === 0) return undefined;

  meetings.sort((a, b) => a.slot.startUtc.localeCompare(b.slot.startUtc));
  const covered = new Set(meetings.flatMap((m) => m.attendeeIds));

  return {
    meetings,
    coveredParticipantIds: [...covered],
    uncoveredParticipantIds: participants.map((p) => p.id).filter((id) => !covered.has(id)),
  };
}

/** Breadth-first search over covered-participant bitmasks; first cover found is minimal. */
function minimalCover(options: number[], target: number): number[] {
  if (target === 0) return [];

  const seen = new Set<number>([0]);
  let frontier: { mask: number; picked: number[] }[] = [{ mask: 0, picked: [] }];

  while (frontier.length > 0) {
    const next: typeof frontier = [];

    for (const state of frontier) {
      for (const option of options) {
        const mask = state.mask | option;
        if (mask === state.mask || seen.has(mask)) continue;

        const picked = [...state.picked, option];
        if (mask === target) return picked;

        seen.add(mask);
        next.push({ mask, picked });
      }
    }

    frontier = next;
  }

  return greedyCover(options, target);
}

/** Fallback for group sizes where exhaustive search stops being cheap. */
function greedyCover(options: number[], target: number): number[] {
  const picked: number[] = [];
  let remaining = target;

  while (remaining !== 0) {
    let best = 0;
    let bestGain = 0;

    for (const option of options) {
      const gain = popcount(option & remaining);
      if (gain > bestGain) {
        bestGain = gain;
        best = option;
      }
    }

    if (bestGain === 0) break;
    picked.push(best);
    remaining &= ~best;
  }

  return picked;
}

function popcount(value: number): number {
  let count = 0;
  for (let v = value; v !== 0; v >>= 1) count += v & 1;
  return count;
}

/** Describe a participant's recurring availability as a UTC time-of-day window. */
function utcWindowLabel(participant: Participant, range: Interval): string {
  const windows = expandWorkingHours(participant, range);
  if (windows.length === 0) return "no availability";

  const first = windows[0];
  const start = DateTime.fromMillis(first.start, { zone: "utc" }).toFormat("HH:mm");
  const end = DateTime.fromMillis(first.end, { zone: "utc" }).toFormat("HH:mm");
  return `${start}-${end} UTC`;
}

/**
 * Find pairs who can never share a slot of the requested length.
 *
 * When the whole group cannot meet, the useful question is which specific
 * constraint is responsible. A pair whose availability never intersects is a hard
 * structural blocker - no choice of day or duration will fix it - and naming that
 * pair explains the result far better than reporting a global failure.
 */
export function findBlockingPairs(
  participants: Participant[],
  range: Interval,
  durationMs: number,
): BlockingPair[] {
  const free = new Map(participants.map((p) => [p.id, freeIntervals(p, range)]));
  const pairs: BlockingPair[] = [];

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i];
      const b = participants[j];

      const shared = intersect(free.get(a.id) ?? [], free.get(b.id) ?? []);
      const fits = shared.some((interval) => interval.end - interval.start >= durationMs);
      if (fits) continue;

      pairs.push({
        aId: a.id,
        aName: a.name,
        bId: b.id,
        bName: b.name,
        explanation: `${a.name} (${utcWindowLabel(a, range)}) and ${b.name} (${utcWindowLabel(b, range)}) never overlap for ${durationMs / MINUTE} minutes.`,
      });
    }
  }

  return pairs;
}

/** How far outside their normal hours a participant would be pushed by this slot. */
function stretchMinutes(windows: Interval[], start: Instant, end: Instant): number {
  if (windows.length === 0) return Infinity;

  let best = Infinity;
  for (const window of windows) {
    const stretch = Math.max(0, window.start - start) + Math.max(0, end - window.end);
    best = Math.min(best, stretch);
  }
  return best / MINUTE;
}

/**
 * The cheapest single meeting that includes everyone, and what it costs.
 *
 * Reported as a fact, not a recommendation. For the supplied team the best case
 * still puts one person near 03:00 and another near 21:00, and showing that total
 * lets a coordinator reject the idea on evidence. Deciding who absorbs it is not
 * the scheduler's call.
 */
export function findForcedOption(
  participants: Participant[],
  range: Interval,
  durationMs: number,
  granularityMs: number,
): ForcedOption | undefined {
  const padding = 24 * 60 * MINUTE;
  const padded = { start: range.start - padding, end: range.end + padding };
  const windows = new Map(participants.map((p) => [p.id, expandWorkingHours(p, padded)]));

  let bestStart: Instant | undefined;
  let bestTotal = Infinity;
  let bestWorst = Infinity;

  for (let start = range.start; start + durationMs <= range.end; start += granularityMs) {
    const end = start + durationMs;

    let total = 0;
    let worst = 0;
    for (const participant of participants) {
      const stretch = stretchMinutes(windows.get(participant.id) ?? [], start, end);
      if (!Number.isFinite(stretch)) {
        total = Infinity;
        break;
      }
      total += stretch;
      worst = Math.max(worst, stretch);
    }

    // Prefer the lowest total burden, then the least painful worst case, so the
    // cost is not concentrated on one person when it can be shared.
    if (total < bestTotal || (total === bestTotal && worst < bestWorst)) {
      bestTotal = total;
      bestWorst = worst;
      bestStart = start;
    }
  }

  if (bestStart === undefined || !Number.isFinite(bestTotal)) return undefined;

  const run: CandidateRun = {
    firstStart: bestStart,
    lastStart: bestStart,
    attendeeIds: participants.map((p) => p.id),
  };

  return {
    slot: toSlot(run, participants, durationMs),
    totalStretchMinutes: Math.round(bestTotal),
    worstStretchMinutes: Math.round(bestWorst),
  };
}

function describeCount(count: number): string {
  return count === 1 ? "1 participant" : `${count} participants`;
}

/** Assemble the full explanation of why the group cannot meet. */
export function buildDiagnosis(
  participants: Participant[],
  range: Interval,
  durationMs: number,
  granularityMs: number,
  bestCoverage: number,
): Diagnosis {
  const blockingPairs = findBlockingPairs(participants, range, durationMs);
  const forcedOption = findForcedOption(participants, range, durationMs, granularityMs);

  const minutes = durationMs / MINUTE;
  const parts = [
    `No ${minutes}-minute slot works for all ${describeCount(participants.length)} in this range.`,
  ];

  if (bestCoverage > 0) {
    parts.push(`The best available option covers ${bestCoverage} of ${participants.length}.`);
  }

  if (blockingPairs.length > 0) {
    parts.push(
      blockingPairs.length === 1
        ? blockingPairs[0].explanation
        : `${blockingPairs.length} pairs of participants have no overlapping availability at all.`,
    );
  }

  return { summary: parts.join(" "), blockingPairs, forcedOption };
}
