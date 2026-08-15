import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { describeParticipantSlot, expandWorkingHours, freeIntervals } from "./availability";
import { SEED_PARTICIPANTS } from "../seed";
import type { Participant } from "./types";
import { WEEKDAYS } from "./types";

const person = (id: string) => SEED_PARTICIPANTS.find((p) => p.id === id)!;

/** The week from the brief, as an absolute range. */
const WEEK = {
  start: DateTime.fromISO("2026-03-08", { zone: "utc" }).startOf("day").toMillis(),
  end: DateTime.fromISO("2026-03-14", { zone: "utc" }).endOf("day").toMillis(),
};

const utc = (ms: number) => DateTime.fromMillis(ms, { zone: "utc" }).toFormat("ccc HH:mm");

describe("daylight saving", () => {
  /**
   * The requested week begins on 8 March 2026, the day US daylight saving starts.
   * Hardcoded offsets, or assuming March is still PST, shift Sara's entire window
   * by an hour and quietly corrupt every result involving her.
   */
  it("places San Francisco on PDT (UTC-7) during the requested week", () => {
    const windows = expandWorkingHours(person("sara"), WEEK);
    const monday = windows.find((w) => utc(w.start).startsWith("Mon"))!;

    expect(utc(monday.start)).toBe("Mon 13:00"); // 06:00 PDT, not 14:00 as PST would give
    expect(utc(monday.end)).toBe("Mon 22:00"); // 15:00 PDT
  });

  it("still resolves San Francisco to PST (UTC-8) before the transition", () => {
    const februaryWeek = {
      start: DateTime.fromISO("2026-02-09", { zone: "utc" }).startOf("day").toMillis(),
      end: DateTime.fromISO("2026-02-13", { zone: "utc" }).endOf("day").toMillis(),
    };
    const windows = expandWorkingHours(person("sara"), februaryWeek);
    const monday = windows.find((w) => utc(w.start).startsWith("Mon"))!;

    expect(utc(monday.start)).toBe("Mon 14:00"); // 06:00 PST
  });

  it("reports the zone abbreviation for the specific date, not a fixed label", () => {
    const march = describeParticipantSlot(
      person("sara"),
      DateTime.fromISO("2026-03-10T16:00:00Z").toMillis(),
      DateTime.fromISO("2026-03-10T16:45:00Z").toMillis(),
      true,
    );
    const february = describeParticipantSlot(
      person("sara"),
      DateTime.fromISO("2026-02-10T16:00:00Z").toMillis(),
      DateTime.fromISO("2026-02-10T16:45:00Z").toMillis(),
      true,
    );

    expect(march.zoneAbbreviation).toBe("PDT");
    expect(february.zoneAbbreviation).toBe("PST");
  });
});

describe("expandWorkingHours", () => {
  it("produces one window per working day", () => {
    // Mon-Fri only: the range spans 8-14 March but the weekend is excluded.
    expect(expandWorkingHours(person("maya"), WEEK)).toHaveLength(5);
  });

  it("converts Bangalore hours across the half-hour offset", () => {
    const monday = expandWorkingHours(person("maya"), WEEK)[0];
    expect(utc(monday.start)).toBe("Mon 03:30"); // 09:00 IST
    expect(utc(monday.end)).toBe("Mon 12:30"); // 18:00 IST
  });

  /**
   * Sydney's local working day starts before midnight UTC, so a window belonging
   * to one local date lands on the previous UTC date. Iterating UTC days rather
   * than local days would drop these.
   */
  it("keeps Sydney windows that begin on the previous UTC day", () => {
    const windows = expandWorkingHours(person("jack"), WEEK);
    const first = windows[0];

    expect(utc(first.start)).toBe("Sun 23:00"); // Monday 10:00 in Sydney
    expect(utc(first.end)).toBe("Mon 08:00"); // Monday 19:00 in Sydney
  });

  it("treats an end at or before the start as an overnight window", () => {
    const nightShift: Participant = {
      id: "night",
      name: "Night",
      location: "London",
      timeZone: "Europe/London",
      workingHours: { start: "22:00", end: "06:00", days: WEEKDAYS },
      busy: [],
    };

    const first = expandWorkingHours(nightShift, WEEK)[0];
    expect(first.end - first.start).toBe(8 * 60 * 60 * 1000);
  });

  it("rejects an unknown time zone", () => {
    const broken = { ...person("maya"), timeZone: "Mars/Olympus" };
    expect(() => expandWorkingHours(broken, WEEK)).toThrow(/Unknown time zone/);
  });
});

describe("freeIntervals", () => {
  it("subtracts a pre-existing meeting from working hours", () => {
    const withMeeting: Participant = {
      ...person("tom"),
      busy: [
        {
          id: "standup",
          title: "Standup",
          startUtc: "2026-03-09T09:00:00Z",
          endUtc: "2026-03-09T10:00:00Z",
        },
      ],
    };

    const monday = freeIntervals(withMeeting, WEEK).filter((w) => utc(w.start).startsWith("Mon"));

    expect(monday).toHaveLength(2);
    expect(utc(monday[0].end)).toBe("Mon 09:00");
    expect(utc(monday[1].start)).toBe("Mon 10:00");
  });
});

describe("unavailability reasons", () => {
  it("explains how far before someone's day a slot falls", () => {
    // 11:00 UTC is 04:00 in San Francisco, two hours before Sara starts.
    const view = describeParticipantSlot(
      person("sara"),
      DateTime.fromISO("2026-03-10T11:00:00Z").toMillis(),
      DateTime.fromISO("2026-03-10T11:45:00Z").toMillis(),
      false,
    );

    expect(view.reasonKind).toBe("outside-hours");
    expect(view.reason).toBe("2h before their 06:00 start");
  });

  it("names the conflicting meeting", () => {
    const withMeeting: Participant = {
      ...person("tom"),
      busy: [
        {
          id: "review",
          title: "Design review",
          startUtc: "2026-03-10T09:00:00Z",
          endUtc: "2026-03-10T10:00:00Z",
        },
      ],
    };

    const view = describeParticipantSlot(
      withMeeting,
      DateTime.fromISO("2026-03-10T09:15:00Z").toMillis(),
      DateTime.fromISO("2026-03-10T10:00:00Z").toMillis(),
      false,
    );

    expect(view.reasonKind).toBe("conflict");
    expect(view.reason).toBe('Busy with "Design review"');
  });
});
