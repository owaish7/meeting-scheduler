/**
 * The team from the brief, used to populate the app on first load.
 *
 * Locations are stored as IANA zone identifiers rather than city names, since
 * that is what carries the daylight-saving rules. "Bangalore" is a label for
 * humans; "Asia/Kolkata" is the thing the scheduler can reason about.
 */

import type { Participant } from "./scheduling/types";
import { WEEKDAYS } from "./scheduling/types";

export const SEED_PARTICIPANTS: Participant[] = [
  {
    id: "maya",
    name: "Maya",
    location: "Bangalore",
    timeZone: "Asia/Kolkata",
    workingHours: { start: "09:00", end: "18:00", days: WEEKDAYS },
    busy: [],
  },
  {
    id: "tom",
    name: "Tom",
    location: "London",
    timeZone: "Europe/London",
    workingHours: { start: "08:00", end: "17:00", days: WEEKDAYS },
    busy: [],
  },
  {
    id: "sara",
    name: "Sara",
    location: "San Francisco",
    timeZone: "America/Los_Angeles",
    workingHours: { start: "06:00", end: "15:00", days: WEEKDAYS },
    busy: [],
  },
  {
    id: "jack",
    name: "Jack",
    location: "Sydney",
    timeZone: "Australia/Sydney",
    workingHours: { start: "10:00", end: "19:00", days: WEEKDAYS },
    busy: [],
  },
];

/** The week the brief asks about. Used as the default search range. */
export const DEFAULT_RANGE = { from: "2026-03-08", to: "2026-03-14" };

export const DEFAULT_DURATION_MINUTES = 45;
