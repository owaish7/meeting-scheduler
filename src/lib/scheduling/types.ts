/**
 * Types for the scheduling logic.
 *
 * Rule for this whole module: anything named `*Utc`, or typed as `Instant`, is
 * an absolute moment in time (epoch milliseconds). Local wall-clock time only
 * shows up at the edges - reading input and rendering output. Nothing in
 * between deals with it.
 */

/** An absolute point in time, as epoch milliseconds. */
export type Instant = number;

/** A half-open absolute interval `[start, end)`. */
export interface Interval {
  start: Instant;
  end: Instant;
}

/** ISO weekday, matching Luxon: 1 = Monday ... 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];

/** A recurring daily availability window, expressed in the participant's own local time. */
export interface WorkingHours {
  /** Local wall-clock start, "HH:mm" (e.g. "09:00"). */
  start: string;
  /** Local wall-clock end, "HH:mm" (e.g. "18:00"). */
  end: string;
  /** Days this window applies to. Defaults to Mon-Fri. */
  days: Weekday[];
}

/** A pre-existing commitment that blocks part of a participant's working hours. */
export interface BusyBlock {
  id: string;
  title: string;
  /** Absolute start/end, stored as ISO 8601 strings with offset. */
  startUtc: string;
  endUtc: string;
}

export interface Participant {
  id: string;
  name: string;
  /** Free-text location shown in the UI, e.g. "Bangalore". Display only. */
  location: string;
  /** IANA zone identifier, e.g. "Asia/Kolkata". This is what the maths uses. */
  timeZone: string;
  workingHours: WorkingHours;
  busy: BusyBlock[];
}

/** Why a participant cannot attend a given slot. */
export type UnavailabilityKind = "outside-hours" | "conflict" | "non-working-day";

/** How one participant relates to one candidate slot. */
export interface ParticipantSlotView {
  participantId: string;
  name: string;
  timeZone: string;
  location: string;
  available: boolean;
  /** Local wall-clock rendering of the slot for this participant. */
  localDate: string;
  localStart: string;
  localEnd: string;
  /** Short zone label for the slot's date, e.g. "PDT" - varies with DST. */
  zoneAbbreviation: string;
  /**
   * Whole days between this participant's local date and the slot's UTC date:
   * -1 the day before, 0 the same day, +1 the day after.
   *
   * A meeting at 04:30 UTC on Monday falls on Sunday evening in San Francisco.
   * That is correct and is exactly the kind of result that reads as a bug, so
   * the shift is reported rather than left for the reader to notice.
   */
  dayOffset: number;
  /** Human-readable explanation, present only when `available` is false. */
  reason?: string;
  reasonKind?: UnavailabilityKind;
}

/** A candidate meeting time, merged across every contiguous position with the same attendees. */
export interface Slot {
  /**
   * The recommended start, chosen from within the run for the best balance across
   * attendees rather than simply the earliest position.
   */
  startUtc: string;
  endUtc: string;
  /**
   * The flexible range this slot can move within. Contiguous candidate positions
   * are merged into one result, so the meeting can begin anywhere between
   * `earliestStartUtc` and `latestStartUtc` without changing who can attend.
   */
  earliestStartUtc: string;
  latestStartUtc: string;
  attendeeCount: number;
  totalParticipants: number;
  /** True when every requested participant can attend. */
  isFullMatch: boolean;
  participants: ParticipantSlotView[];
  /**
   * Other dates (ISO, UTC) where this same option recurs identically - same
   * people, same time of day. Recurring availability repeats every working day,
   * so listing those dates here collapses what would otherwise be one
   * near-identical result per day.
   */
  repeatsOn: string[];
}

/** A single meeting within a split plan. */
export interface SplitMeeting {
  slot: Slot;
  attendeeIds: string[];
}

/**
 * A fallback covering everyone across several meetings, where no single meeting
 * can include the whole group and nobody is asked to work outside their hours.
 */
export interface SplitPlan {
  meetings: SplitMeeting[];
  coveredParticipantIds: string[];
  uncoveredParticipantIds: string[];
}

/** A pair of participants whose working hours can never overlap. */
export interface BlockingPair {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  explanation: string;
}

/** The cost of forcing the entire group into one meeting anyway. */
export interface ForcedOption {
  slot: Slot;
  /** Total minutes worked outside normal hours, summed across all participants. */
  totalStretchMinutes: number;
  /** The largest single-participant burden, in minutes. */
  worstStretchMinutes: number;
}

/** Explanation of why no slot works for everyone. */
export interface Diagnosis {
  summary: string;
  blockingPairs: BlockingPair[];
  forcedOption?: ForcedOption;
}

export interface SuggestRequest {
  participants: Participant[];
  durationMinutes: number;
  /** Search range as ISO 8601 dates, interpreted in UTC. Both ends are inclusive. */
  from: string;
  to: string;
  granularityMinutes?: number;
  maxResults?: number;
}

/**
 * One participant's working day placed on a shared 24-hour UTC axis.
 *
 * Lets the UI draw everyone's availability against a common scale, which turns
 * "Sara and Jack never overlap" from a claim into something visible. Minutes are
 * measured from UTC midnight; when `utcEndMinute` is less than `utcStartMinute`
 * the window crosses midnight and draws as two segments - the usual case for
 * Sydney, whose working day starts the previous UTC day.
 */
export interface TimelineWindow {
  participantId: string;
  name: string;
  location: string;
  timeZone: string;
  localStart: string;
  localEnd: string;
  utcStartMinute: number;
  utcEndMinute: number;
}

export interface SuggestResponse {
  /** Slots where every participant can attend. Empty when the group cannot meet. */
  fullMatches: Slot[];
  /** Highest-coverage alternatives, present only when `fullMatches` is empty. */
  bestEffort: Slot[];
  /** A set of meetings covering everyone, present only when `fullMatches` is empty. */
  splitPlan?: SplitPlan;
  /** Why no full match exists, present only when `fullMatches` is empty. */
  diagnosis?: Diagnosis;
  /** Everyone's working day on a shared UTC axis, for visualising the overlap. */
  timeline: TimelineWindow[];
  meta: {
    durationMinutes: number;
    granularityMinutes: number;
    searchedFrom: string;
    searchedTo: string;
    participantCount: number;
  };
}
