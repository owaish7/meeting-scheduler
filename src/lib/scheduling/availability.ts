/**
 * Converts participants' local availability into absolute time.
 *
 * This is the only module that knows about time zones. It takes recurring local
 * wall-clock hours ("09:00-18:00, weekdays, Asia/Kolkata") and resolves them into
 * absolute intervals, then subtracts pre-existing meetings. Everything downstream
 * works purely with the resulting instants.
 *
 * Offsets are never computed by hand. Luxon resolves each local date against the
 * IANA database, so a window is anchored to the offset in force on that specific
 * date - which is what makes daylight-saving transitions come out right. The
 * supplied dataset depends on this: US DST begins on 8 Mar 2026, the first day of
 * the requested week, so San Francisco is on PDT (UTC-7) and not PST (UTC-8).
 */

import { DateTime, IANAZone } from "luxon";
import { clip, normalize, subtract } from "./intervals";
import type {
  BusyBlock,
  Instant,
  Interval,
  Participant,
  ParticipantSlotView,
  TimelineWindow,
  UnavailabilityKind,
} from "./types";

export function isValidTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

/** Parse "HH:mm" into hour and minute. Throws on malformed input. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time "${value}", expected HH:mm`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${value}"`);

  return { hour, minute };
}

/**
 * Expand recurring local working hours into absolute intervals covering `range`.
 *
 * Iteration runs over the participant's *local* calendar days, one day either
 * side of the range. The padding matters: Sydney's local Tuesday 10:00-19:00
 * begins at 23:00 UTC on Monday, so a window belonging to a local day outside the
 * range can still overlap it.
 */
export function expandWorkingHours(participant: Participant, range: Interval): Interval[] {
  const zone = participant.timeZone;
  if (!isValidTimeZone(zone)) throw new Error(`Unknown time zone "${zone}"`);

  const { start, end, days } = participant.workingHours;
  const from = parseTimeOfDay(start);
  const to = parseTimeOfDay(end);

  const firstDay = DateTime.fromMillis(range.start, { zone }).startOf("day").minus({ days: 1 });
  const lastDay = DateTime.fromMillis(range.end, { zone }).startOf("day").plus({ days: 1 });

  const windows: Interval[] = [];
  for (let day = firstDay; day <= lastDay; day = day.plus({ days: 1 })) {
    if (!days.includes(day.weekday as (typeof days)[number])) continue;

    const windowStart = day.set({ ...from, second: 0, millisecond: 0 });
    let windowEnd = day.set({ ...to, second: 0, millisecond: 0 });

    // An end at or before the start means the window runs past local midnight
    // (for example a 22:00-06:00 shift), so it belongs to the following day.
    if (windowEnd <= windowStart) windowEnd = windowEnd.plus({ days: 1 });

    windows.push({ start: windowStart.toMillis(), end: windowEnd.toMillis() });
  }

  return clip(normalize(windows), range);
}

/**
 * Place a participant's working day on a shared 24-hour UTC axis.
 *
 * Uses the first window falling in the range, so the offset is the one actually
 * in force then rather than a nominal one - during the requested week that is
 * what puts San Francisco at 13:00-22:00 UTC on PDT rather than an hour later.
 */
export function describeTimelineWindow(
  participant: Participant,
  range: Interval,
): TimelineWindow | undefined {
  const windows = expandWorkingHours(participant, range);
  if (windows.length === 0) return undefined;

  const zone = participant.timeZone;
  const first = windows[0];
  const start = DateTime.fromMillis(first.start, { zone: "utc" });
  const end = DateTime.fromMillis(first.end, { zone: "utc" });

  return {
    participantId: participant.id,
    name: participant.name,
    location: participant.location,
    timeZone: zone,
    localStart: DateTime.fromMillis(first.start, { zone }).toFormat("HH:mm"),
    localEnd: DateTime.fromMillis(first.end, { zone }).toFormat("HH:mm"),
    utcStartMinute: start.hour * 60 + start.minute,
    utcEndMinute: end.hour * 60 + end.minute,
  };
}

/** A participant's pre-existing meetings as absolute intervals. */
export function busyIntervals(participant: Participant): Interval[] {
  return normalize(
    participant.busy.map((block) => ({
      start: DateTime.fromISO(block.startUtc).toMillis(),
      end: DateTime.fromISO(block.endUtc).toMillis(),
    })),
  );
}

/** Working hours minus pre-existing meetings: when this person can actually meet. */
export function freeIntervals(participant: Participant, range: Interval): Interval[] {
  return subtract(expandWorkingHours(participant, range), busyIntervals(participant));
}

/** The pre-existing meeting overlapping `[start, end)`, if any. */
function findConflict(participant: Participant, start: Instant, end: Instant): BusyBlock | undefined {
  return participant.busy.find((block) => {
    const blockStart = DateTime.fromISO(block.startUtc).toMillis();
    const blockEnd = DateTime.fromISO(block.endUtc).toMillis();
    return blockStart < end && blockEnd > start;
  });
}

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Explain why a participant cannot attend, in terms a coordinator can act on.
 *
 * "75 min before their 09:00 start" is useful; "unavailable" is not. The search
 * widens by two days either side so a nearby window can still be found and
 * measured against, rather than reporting a bare failure.
 */
function explainUnavailability(
  participant: Participant,
  start: Instant,
  end: Instant,
): { kind: UnavailabilityKind; reason: string } {
  const conflict = findConflict(participant, start, end);
  if (conflict) {
    return { kind: "conflict", reason: `Busy with "${conflict.title}"` };
  }

  const DAY = 24 * 60 * 60 * 1000;
  const nearby = expandWorkingHours(participant, { start: start - 2 * DAY, end: end + 2 * DAY });

  if (nearby.length === 0) {
    return { kind: "non-working-day", reason: "Outside their working days" };
  }

  // The closest window is the one requiring the least movement to reach.
  let best = nearby[0];
  let bestStretch = Infinity;
  for (const window of nearby) {
    const stretch = Math.max(0, window.start - start) + Math.max(0, end - window.end);
    if (stretch < bestStretch) {
      bestStretch = stretch;
      best = window;
    }
  }

  const zone = participant.timeZone;
  if (start < best.start) {
    const early = (best.start - start) / 60000;
    const opens = DateTime.fromMillis(best.start, { zone }).toFormat("HH:mm");
    return { kind: "outside-hours", reason: `${formatMinutes(early)} before their ${opens} start` };
  }

  const late = (end - best.end) / 60000;
  const closes = DateTime.fromMillis(best.end, { zone }).toFormat("HH:mm");
  return { kind: "outside-hours", reason: `${formatMinutes(late)} after their ${closes} end` };
}

/**
 * Render a slot from one participant's point of view.
 *
 * The API returns this fully resolved so the UI never repeats time-zone maths.
 * Duplicating that logic on the client would be the obvious place for the two
 * sides to drift apart.
 */
export function describeParticipantSlot(
  participant: Participant,
  start: Instant,
  end: Instant,
  available: boolean,
): ParticipantSlotView {
  const zone = participant.timeZone;
  const localStart = DateTime.fromMillis(start, { zone });
  const localEnd = DateTime.fromMillis(end, { zone });

  // Compared as calendar dates rather than instants: the question is which
  // day the participant is on, not how many hours apart the two moments are.
  const utcDate = DateTime.fromMillis(start, { zone: "utc" }).toISODate() ?? "";
  const localDate = localStart.toISODate() ?? "";
  const dayOffset = Math.round(
    DateTime.fromISO(localDate, { zone: "utc" }).diff(
      DateTime.fromISO(utcDate, { zone: "utc" }),
      "days",
    ).days,
  );

  const view: ParticipantSlotView = {
    participantId: participant.id,
    name: participant.name,
    timeZone: zone,
    location: participant.location,
    available,
    localDate: localStart.toFormat("EEE d LLL"),
    localStart: localStart.toFormat("HH:mm"),
    localEnd: localEnd.toFormat("HH:mm"),
    // Resolved per date, so this correctly reads PDT in summer and PST in winter.
    zoneAbbreviation: localStart.toFormat("ZZZZ"),
    dayOffset,
  };

  if (!available) {
    const { kind, reason } = explainUnavailability(participant, start, end);
    view.reason = reason;
    view.reasonKind = kind;
  }

  return view;
}
