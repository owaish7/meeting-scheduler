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
          date: "2026-03-09",
          start: "09:00",
          end: "10:00",
        },
      ],
    };

    const monday = freeIntervals(withMeeting, WEEK).filter((w) => utc(w.start).startsWith("Mon"));

    expect(monday).toHaveLength(2);
    expect(utc(monday[0].end)).toBe("Mon 09:00");
    expect(utc(monday[1].start)).toBe("Mon 10:00");
  });
});

describe("split availability", () => {
  /**
   * A meeting in the middle of the day is how a split day gets expressed - a
   * lunch break, or someone working mornings and late afternoons. There is no
   * separate feature for it: blocking the middle out leaves two windows.
   */
  it("leaves two windows when the middle of a day is blocked", () => {
    const withGap: Participant = {
      ...person("tom"),
      workingHours: { start: "09:00", end: "17:00", days: WEEKDAYS },
      busy: [{ id: "lunch", title: "Blocked", date: "2026-03-09", start: "11:00", end: "15:00" }],
    };

    const monday = freeIntervals(withGap, WEEK).filter((w) => utc(w.start).startsWith("Mon"));

    // London is on GMT that week, so local and UTC read the same here.
    expect(monday.map((w) => `${utc(w.start)}-${utc(w.end)}`)).toEqual([
      "Mon 09:00-Mon 11:00",
      "Mon 15:00-Mon 17:00",
    ]);
  });

  it("converts a meeting through the participant's own zone", () => {
    // 11:00-15:00 entered for Sydney is 00:00-04:00 UTC, not 11:00-15:00 UTC.
    const busySydney: Participant = {
      ...person("jack"),
      busy: [{ id: "x", title: "Blocked", date: "2026-03-10", start: "11:00", end: "15:00" }],
    };

    const free = freeIntervals(busySydney, WEEK);
    const tuesdayMorning = free.find((w) => utc(w.start) === "Mon 23:00")!;

    // Jack's Tuesday starts 23:00 UTC Monday and is cut short by the 00:00 block.
    expect(utc(tuesdayMorning.end)).toBe("Tue 00:00");
  });
});

describe("local day shift", () => {
  it("reports San Francisco on the previous day for an early-UTC meeting", () => {
    // 04:30 UTC on Monday is Sunday evening in San Francisco - correct, and the
    // kind of result that reads as a bug unless it is called out.
    const view = describeParticipantSlot(
      person("sara"),
      DateTime.fromISO("2026-03-09T04:30:00Z").toMillis(),
      DateTime.fromISO("2026-03-09T05:15:00Z").toMillis(),
      false,
    );

    expect(view.localDate).toBe("Sun 8 Mar");
    expect(view.dayOffset).toBe(-1);
  });

  it("reports Sydney on the next day for a late-UTC meeting", () => {
    const view = describeParticipantSlot(
      person("jack"),
      DateTime.fromISO("2026-03-09T14:00:00Z").toMillis(),
      DateTime.fromISO("2026-03-09T14:45:00Z").toMillis(),
      false,
    );

    expect(view.localDate).toBe("Tue 10 Mar");
    expect(view.dayOffset).toBe(1);
  });

  it("reports no shift when the local date matches the UTC date", () => {
    const view = describeParticipantSlot(
      person("tom"),
      DateTime.fromISO("2026-03-09T14:00:00Z").toMillis(),
      DateTime.fromISO("2026-03-09T14:45:00Z").toMillis(),
      true,
    );

    expect(view.dayOffset).toBe(0);
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
          date: "2026-03-10",
          start: "09:00",
          end: "10:00",
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
