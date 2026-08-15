/**
 * Domain types for meeting scheduling.
 *
 * Convention used throughout this module: any field named `*Utc` or typed as
 * `Instant` is an absolute point in time (epoch milliseconds). Local wall-clock
 * time is only ever produced at the edges - when parsing participant input and
 * when rendering results. Nothing in between reasons about local time.
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

export interface SuggestResponse {
  /** Slots where every participant can attend. Empty when the group cannot meet. */
  fullMatches: Slot[];
  /** Highest-coverage alternatives, present only when `fullMatches` is empty. */
  bestEffort: Slot[];
  /** A set of meetings covering everyone, present only when `fullMatches` is empty. */
  splitPlan?: SplitPlan;
  /** Why no full match exists, present only when `fullMatches` is empty. */
  diagnosis?: Diagnosis;
  meta: {
    durationMinutes: number;
    granularityMinutes: number;
    searchedFrom: string;
    searchedTo: string;
    participantCount: number;
  };
}
