import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { suggest } from "./suggest";
import { SchedulingError } from "./suggest";
import { SEED_PARTICIPANTS } from "../seed";
import type { Participant } from "./types";
import { WEEKDAYS } from "./types";

const BRIEF_REQUEST = {
  participants: SEED_PARTICIPANTS,
  durationMinutes: 45,
  from: "2026-03-08",
  to: "2026-03-14",
  maxResults: 50,
};

const label = (slot: { participants: { name: string; available: boolean }[] }) =>
  slot.participants
    .filter((p) => p.available)
    .map((p) => p.name)
    .sort()
    .join(" + ");

const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).toFormat("ccc HH:mm");

/**
 * The scenario from the brief. These expectations were derived independently by
 * an exhaustive sweep before the solver existed, so they pin the real answer
 * rather than whatever the implementation happens to produce.
 */
describe("the team from the brief", () => {
  const result = suggest(BRIEF_REQUEST);

  it("finds no slot that works for all four", () => {
    expect(result.fullMatches).toEqual([]);
  });

  it("does not return an empty result", () => {
    expect(result.bestEffort.length).toBeGreaterThan(0);
    expect(result.diagnosis).toBeDefined();
    expect(result.splitPlan).toBeDefined();
  });

  it("reaches at most two of the four", () => {
    for (const slot of result.bestEffort) {
      expect(slot.attendeeCount).toBe(2);
      expect(slot.totalParticipants).toBe(4);
      expect(slot.isFullMatch).toBe(false);
    }
  });

  it("finds exactly the three viable pairings", () => {
    const pairings = new Set(result.bestEffort.map(label));
    expect(pairings).toEqual(new Set(["Jack + Maya", "Maya + Tom", "Sara + Tom"]));
  });

  it("returns one option per pairing per weekday", () => {
    // Three pairings across five weekdays, with no weekend availability.
    expect(result.bestEffort).toHaveLength(15);
  });

  it("identifies San Francisco and Sydney as the structural blocker", () => {
    const names = result.diagnosis!.blockingPairs.map((p) => [p.aName, p.bName].sort().join(" + "));
    expect(names).toContain("Jack + Sara");
  });

  it("explains the outcome in the summary", () => {
    expect(result.diagnosis!.summary).toContain("No 45-minute slot works for all 4 participants");
    expect(result.diagnosis!.summary).toContain("covers 2 of 4");
  });

  it("covers everyone in two meetings without anyone working outside their hours", () => {
    const plan = result.splitPlan!;

    expect(plan.meetings).toHaveLength(2);
    expect(plan.uncoveredParticipantIds).toEqual([]);
    expect(new Set(plan.coveredParticipantIds)).toEqual(new Set(["maya", "tom", "sara", "jack"]));

    const pairings = new Set(plan.meetings.map((m) => label(m.slot)));
    expect(pairings).toEqual(new Set(["Jack + Maya", "Sara + Tom"]));
  });

  it("reports the cost of forcing everyone into one meeting", () => {
    const forced = result.diagnosis!.forcedOption!;

    // Nobody should be asked to absorb this quietly, so the burden is quantified.
    expect(forced.totalStretchMinutes).toBeGreaterThan(4 * 60);
    expect(forced.slot.attendeeCount).toBe(4);
  });

  it("shows every slot in every participant's local time", () => {
    const slot = result.bestEffort[0];
    expect(slot.participants).toHaveLength(4);

    for (const view of slot.participants) {
      expect(view.localStart).toMatch(/^\d{2}:\d{2}$/);
      expect(view.localEnd).toMatch(/^\d{2}:\d{2}$/);
      expect(view.zoneAbbreviation).toBeTruthy();
      // Anyone who cannot attend must come with an explanation.
      if (!view.available) expect(view.reason).toBeTruthy();
    }
  });
});

describe("when a slot does exist", () => {
  const overlapping: Participant[] = [
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
  ];

  const result = suggest({
    participants: overlapping,
    durationMinutes: 45,
    from: "2026-03-09",
    to: "2026-03-09",
    maxResults: 50,
  });

  it("returns full matches and omits the fallback", () => {
    expect(result.fullMatches.length).toBeGreaterThan(0);
    expect(result.bestEffort).toEqual([]);
    expect(result.diagnosis).toBeUndefined();
    expect(result.splitPlan).toBeUndefined();
  });

  it("confines matches to the overlapping window", () => {
    // Maya 03:30-12:30 UTC and Tom 08:00-17:00 UTC overlap from 08:00 to 12:30.
    for (const slot of result.fullMatches) {
      expect(slot.isFullMatch).toBe(true);
      expect(DateTime.fromISO(slot.startUtc).toMillis()).toBeGreaterThanOrEqual(
        DateTime.fromISO("2026-03-09T08:00:00Z").toMillis(),
      );
      expect(DateTime.fromISO(slot.endUtc).toMillis()).toBeLessThanOrEqual(
        DateTime.fromISO("2026-03-09T12:30:00Z").toMillis(),
      );
    }
  });

  it("merges contiguous positions into a single range", () => {
    // One continuous window should be one result, not sixteen offset by 15 minutes.
    expect(result.fullMatches).toHaveLength(1);
    expect(utc(result.fullMatches[0].earliestStartUtc)).toBe("Mon 08:00");
    expect(utc(result.fullMatches[0].latestStartUtc)).toBe("Mon 11:45");
  });

  it("recommends a time inside the window rather than flush against its edge", () => {
    const slot = result.fullMatches[0];
    const recommended = DateTime.fromISO(slot.startUtc).toMillis();

    // 08:00 is the moment Tom's day begins; the recommendation should have moved off it.
    expect(recommended).toBeGreaterThan(DateTime.fromISO(slot.earliestStartUtc).toMillis());
    expect(recommended).toBeLessThanOrEqual(DateTime.fromISO(slot.latestStartUtc).toMillis());
  });
});

describe("pre-existing meetings", () => {
  it("removes time already booked", () => {
    const busyMorning: Participant[] = SEED_PARTICIPANTS.filter((p) =>
      ["maya", "tom"].includes(p.id),
    ).map((p) =>
      p.id === "tom"
        ? {
            ...p,
            busy: [
              {
                id: "offsite",
                title: "Offsite",
                startUtc: "2026-03-09T08:00:00Z",
                endUtc: "2026-03-09T12:30:00Z",
              },
            ],
          }
        : p,
    );

    const result = suggest({
      participants: busyMorning,
      durationMinutes: 45,
      from: "2026-03-09",
      to: "2026-03-09",
    });

    // Blocking the entire overlap leaves nothing for the pair.
    expect(result.fullMatches).toEqual([]);
  });
});

describe("validation", () => {
  const base = { participants: SEED_PARTICIPANTS, durationMinutes: 45, from: "2026-03-08", to: "2026-03-14" };

  it("rejects an empty participant list", () => {
    expect(() => suggest({ ...base, participants: [] })).toThrow(SchedulingError);
  });

  it("rejects a non-positive duration", () => {
    expect(() => suggest({ ...base, durationMinutes: 0 })).toThrow(SchedulingError);
  });

  it("rejects an end date before the start", () => {
    expect(() => suggest({ ...base, from: "2026-03-14", to: "2026-03-08" })).toThrow(SchedulingError);
  });

  it("rejects an unparseable date", () => {
    expect(() => suggest({ ...base, from: "not-a-date" })).toThrow(SchedulingError);
  });

  it("rejects a range beyond the supported maximum", () => {
    expect(() => suggest({ ...base, to: "2026-12-31" })).toThrow(/Range too large/);
  });
});
