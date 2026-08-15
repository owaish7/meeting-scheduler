/**
 * Interval algebra over absolute time.
 *
 * Everything here is plain integer arithmetic on epoch milliseconds - no dates,
 * no time zones, no DST. That separation is deliberate: once local wall-clock
 * times have been resolved to instants (see `availability.ts`), the overlap
 * problem is ordinary set algebra on a number line and can be tested exhaustively
 * without any calendar reasoning.
 *
 * All intervals are half-open, `[start, end)`. Two intervals that merely touch
 * (`a.end === b.start`) do not overlap - which is the behaviour we want, since a
 * meeting ending at 17:00 and one starting at 17:00 do not conflict.
 */

import type { Instant, Interval } from "./types";

/** An interval with no duration contributes nothing and is always dropped. */
function isNonEmpty(interval: Interval): boolean {
  return interval.end > interval.start;
}

export function duration(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

/**
 * Sort, drop empties, and coalesce overlapping or adjacent intervals.
 *
 * Adjacent intervals are joined: `[1,5)` and `[5,9)` become `[1,9)`. A meeting
 * can legitimately span that boundary, so leaving them separate would hide
 * otherwise-valid slots.
 */
export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter(isNonEmpty)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Intersect two sets of intervals.
 *
 * Both inputs are normalized first, then walked together in a single pass rather
 * than compared pairwise, so this stays linear in the total number of intervals.
 */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const result: Interval[] = [];

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) result.push({ start, end });

    // Advance whichever interval ends first; the other may still overlap the next one.
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return result;
}

/** Intersect any number of interval sets. An empty input means "no constraint". */
export function intersectAll(sets: Interval[][]): Interval[] {
  if (sets.length === 0) return [];
  return sets.reduce((acc, set) => intersect(acc, set));
}

/**
 * Remove `holes` from `source`, returning what remains.
 *
 * Used to subtract pre-existing meetings from working hours. A hole splitting an
 * interval down the middle correctly yields two intervals.
 */
export function subtract(source: Interval[], holes: Interval[]): Interval[] {
  const remaining = normalize(source);
  const blocks = normalize(holes);
  if (blocks.length === 0) return remaining;

  const result: Interval[] = [];
  for (const interval of remaining) {
    let cursor = interval.start;

    for (const block of blocks) {
      if (block.end <= cursor) continue; // hole is entirely before the cursor
      if (block.start >= interval.end) break; // blocks are sorted, so we are done

      if (block.start > cursor) {
        result.push({ start: cursor, end: Math.min(block.start, interval.end) });
      }
      cursor = Math.max(cursor, block.end);
      if (cursor >= interval.end) break;
    }

    if (cursor < interval.end) {
      result.push({ start: cursor, end: interval.end });
    }
  }
  return result.filter(isNonEmpty);
}

/** Restrict intervals to a bounding window. */
export function clip(intervals: Interval[], bounds: Interval): Interval[] {
  return intersect(intervals, [bounds]);
}

/** True when `intervals` fully contains `[start, end)` within a single interval. */
export function containsRange(intervals: Interval[], start: Instant, end: Instant): boolean {
  return intervals.some((interval) => interval.start <= start && interval.end >= end);
}
