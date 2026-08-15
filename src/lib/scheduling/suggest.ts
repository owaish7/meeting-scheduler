/**
 * Entry point for the scheduling logic.
 *
 * One pure function: participants and constraints in, suggestions out. No
 * database, no framework types, no state. The API route around it just
 * validates input and returns JSON - so the part actually worth testing does not
 * care how it gets called.
 */

import { DateTime } from "luxon";
import { describeTimelineWindow } from "./availability";
import { SchedulingError } from "./errors";
import { buildDiagnosis, buildSplitPlan } from "./diagnose";
import { collapseRepeats, rankRuns, sweep, toSlot } from "./solver";
import type { Interval, SuggestRequest, SuggestResponse, TimelineWindow } from "./types";

const MINUTE = 60_000;
const DEFAULT_GRANULARITY_MINUTES = 15;
const DEFAULT_MAX_RESULTS = 10;

/** Guards against a request that would sweep an unreasonable number of positions. */
export const MAX_RANGE_DAYS = 60;

export { SchedulingError };

/**
 * Resolve an ISO date to an absolute instant.
 *
 * Range boundaries are interpreted in UTC and `to` is inclusive of its whole day,
 * so a request for 8-14 March searches through the end of the 14th. Treating the
 * end date as exclusive would silently drop the last day, which is the kind of
 * off-by-one a coordinator would never think to check for.
 */
function resolveRange(from: string, to: string): Interval {
  const start = DateTime.fromISO(from, { zone: "utc" }).startOf("day");
  const end = DateTime.fromISO(to, { zone: "utc" }).endOf("day");

  if (!start.isValid) throw new SchedulingError(`Invalid start date "${from}"`);
  if (!end.isValid) throw new SchedulingError(`Invalid end date "${to}"`);
  if (end <= start) throw new SchedulingError("End date must be on or after the start date");

  const days = end.diff(start, "days").days;
  if (days > MAX_RANGE_DAYS) {
    throw new SchedulingError(`Range too large: ${Math.ceil(days)} days, maximum is ${MAX_RANGE_DAYS}`);
  }

  return { start: start.toMillis(), end: end.toMillis() };
}

export function suggest(request: SuggestRequest): SuggestResponse {
  const {
    participants,
    durationMinutes,
    from,
    to,
    granularityMinutes = DEFAULT_GRANULARITY_MINUTES,
    maxResults = DEFAULT_MAX_RESULTS,
  } = request;

  if (participants.length === 0) {
    throw new SchedulingError("At least one participant is required");
  }
  if (durationMinutes <= 0) {
    throw new SchedulingError("Duration must be greater than zero");
  }
  if (granularityMinutes <= 0) {
    throw new SchedulingError("Granularity must be greater than zero");
  }

  const range = resolveRange(from, to);
  const durationMs = durationMinutes * MINUTE;
  const granularityMs = granularityMinutes * MINUTE;

  const { runs, freeByParticipant } = sweep(participants, range, durationMs, granularityMs);
  const ranked = rankRuns(runs, durationMs, granularityMs, freeByParticipant);

  const meta = {
    durationMinutes,
    granularityMinutes,
    searchedFrom: DateTime.fromMillis(range.start, { zone: "utc" }).toISO() ?? "",
    searchedTo: DateTime.fromMillis(range.end, { zone: "utc" }).toISO() ?? "",
    participantCount: participants.length,
  };

  // Returned in both outcomes so the response shape stays uniform, though only
  // the no-match case has a use for it: when a time does work, the slots already
  // answer the question and the overlap needs no separate telling.
  const timeline = participants
    .map((participant) => describeTimelineWindow(participant, range))
    .filter((window): window is TimelineWindow => window !== undefined);

  // Options that recur on other days are folded into one result each, so the
  // caller receives the distinct choices rather than one copy per weekday.
  const present = (runs: typeof ranked) =>
    collapseRepeats(runs)
      .slice(0, maxResults)
      .map((group) => toSlot(group.representative, participants, durationMs, group.repeatDates));

  const fullRuns = ranked.filter((run) => run.attendeeIds.length === participants.length);
  if (fullRuns.length > 0) {
    return { fullMatches: present(fullRuns), bestEffort: [], timeline, meta };
  }

  // Nothing covers the whole group, so the fallback becomes the answer.
  const bestCoverage = ranked[0]?.attendeeIds.length ?? 0;

  return {
    fullMatches: [],
    bestEffort: present(ranked.filter((run) => run.attendeeIds.length === bestCoverage)),
    splitPlan: buildSplitPlan(ranked, participants, durationMs),
    diagnosis: buildDiagnosis(participants, range, durationMs, granularityMs, bestCoverage),
    timeline,
    meta,
  };
}
