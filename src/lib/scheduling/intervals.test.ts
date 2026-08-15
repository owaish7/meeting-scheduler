import { describe, expect, it } from "vitest";
import { clip, containsRange, intersect, intersectAll, normalize, subtract } from "./intervals";

/** Small readable numbers stand in for instants - the algebra does not care about scale. */
const iv = (start: number, end: number) => ({ start, end });

describe("normalize", () => {
  it("sorts and merges overlapping intervals", () => {
    expect(normalize([iv(10, 20), iv(0, 5), iv(15, 30)])).toEqual([iv(0, 5), iv(10, 30)]);
  });

  it("joins adjacent intervals so a meeting can span the boundary", () => {
    expect(normalize([iv(0, 5), iv(5, 10)])).toEqual([iv(0, 10)]);
  });

  it("drops zero-length and inverted intervals", () => {
    expect(normalize([iv(5, 5), iv(10, 4), iv(0, 3)])).toEqual([iv(0, 3)]);
  });

  it("absorbs a fully nested interval", () => {
    expect(normalize([iv(0, 100), iv(20, 30)])).toEqual([iv(0, 100)]);
  });
});

describe("intersect", () => {
  it("returns the overlapping region", () => {
    expect(intersect([iv(0, 10)], [iv(5, 20)])).toEqual([iv(5, 10)]);
  });

  it("treats touching intervals as non-overlapping", () => {
    // Half-open intervals: a meeting ending at 17:00 does not clash with one starting then.
    expect(intersect([iv(0, 10)], [iv(10, 20)])).toEqual([]);
  });

  it("handles one interval spanning several on the other side", () => {
    expect(intersect([iv(0, 100)], [iv(10, 20), iv(40, 50)])).toEqual([iv(10, 20), iv(40, 50)]);
  });

  it("returns nothing when either side is empty", () => {
    expect(intersect([], [iv(0, 10)])).toEqual([]);
    expect(intersect([iv(0, 10)], [])).toEqual([]);
  });
});

describe("intersectAll", () => {
  it("narrows across every set", () => {
    expect(intersectAll([[iv(0, 100)], [iv(10, 60)], [iv(20, 40)]])).toEqual([iv(20, 40)]);
  });

  it("returns nothing when one set excludes the rest", () => {
    expect(intersectAll([[iv(0, 10)], [iv(50, 60)]])).toEqual([]);
  });
});

describe("subtract", () => {
  it("splits an interval when a hole falls inside it", () => {
    expect(subtract([iv(0, 100)], [iv(40, 60)])).toEqual([iv(0, 40), iv(60, 100)]);
  });

  it("trims from the leading and trailing edges", () => {
    expect(subtract([iv(0, 100)], [iv(0, 20)])).toEqual([iv(20, 100)]);
    expect(subtract([iv(0, 100)], [iv(80, 100)])).toEqual([iv(0, 80)]);
  });

  it("removes an interval covered entirely by a hole", () => {
    expect(subtract([iv(10, 20)], [iv(0, 100)])).toEqual([]);
  });

  it("applies several holes to one interval", () => {
    expect(subtract([iv(0, 100)], [iv(10, 20), iv(50, 60)])).toEqual([
      iv(0, 10),
      iv(20, 50),
      iv(60, 100),
    ]);
  });

  it("ignores holes that do not intersect", () => {
    expect(subtract([iv(0, 10)], [iv(50, 60)])).toEqual([iv(0, 10)]);
  });

  it("returns the source unchanged when there are no holes", () => {
    expect(subtract([iv(0, 10)], [])).toEqual([iv(0, 10)]);
  });
});

describe("clip", () => {
  it("restricts intervals to the bounding window", () => {
    expect(clip([iv(0, 100)], iv(20, 40))).toEqual([iv(20, 40)]);
  });

  it("drops intervals outside the bounds", () => {
    expect(clip([iv(0, 10), iv(50, 60)], iv(40, 100))).toEqual([iv(50, 60)]);
  });
});

describe("containsRange", () => {
  it("requires a single interval to cover the whole range", () => {
    expect(containsRange([iv(0, 100)], 10, 20)).toBe(true);
    expect(containsRange([iv(0, 100)], 0, 100)).toBe(true);
  });

  it("rejects a range spanning a gap between two intervals", () => {
    // A meeting cannot straddle a break, even if both sides are free.
    expect(containsRange([iv(0, 50), iv(50, 100)], 40, 60)).toBe(false);
  });

  it("rejects a range extending past the end", () => {
    expect(containsRange([iv(0, 100)], 90, 110)).toBe(false);
  });
});
