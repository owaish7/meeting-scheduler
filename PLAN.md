# PLAN.md

Meeting Scheduler — written before any application code.

---

## 1. What I did first: check whether the problem has an answer

Before designing anything I computed the supplied dataset against real IANA timezone data, because
the shape of the answer determines the shape of the app.

Local weekday hours converted to a single absolute timeline (UTC), for Mon 9 – Fri 13 Mar 2026:

| Person | Zone | Local hours | UTC window |
|---|---|---|---|
| Maya | `Asia/Kolkata` (IST, UTC+5:30) | 09:00–18:00 | 03:30–12:30 |
| Tom | `Europe/London` (GMT, UTC+0) | 08:00–17:00 | 08:00–17:00 |
| Sara | `America/Los_Angeles` (**PDT, UTC−7**) | 06:00–15:00 | 13:00–22:00 |
| Jack | `Australia/Sydney` (AEDT, UTC+11) | 10:00–19:00 | 23:00–08:00 *(wraps midnight)* |

**Finding: there is no 45-minute slot that works for all four people, on any day of that week.**

Exhaustive sweep at 15-minute granularity. Maximum achievable coverage is **2 of 4**, and only these
three pairings exist — identically, every weekday:

- `Maya + Jack` — 03:30–08:00 UTC (4h30m window)
- `Maya + Tom` — 08:00–12:30 UTC (4h30m window)
- `Tom + Sara` — 13:00–17:00 UTC (4h00m window)

Every three-person and four-person combination is empty. The blocking constraint is structural:
**Sara's earliest start (13:00 UTC) is after Jack's latest end (08:00 UTC)**, so those two can never
share a working minute regardless of duration or day.

This is what the brief means by *"an empty screen isn't good enough."* The naive implementation is
not wrong — it correctly returns nothing. It is simply useless. **So the fallback is the product,
not an error path**, and I've planned it as a first-class feature rather than a nicety.

## 2. The second thing I checked: daylight saving

The requested week begins **Sunday 8 March 2026**, which is the exact day US daylight saving time
starts. Sara is therefore on **PDT (UTC−7)**, not PST (UTC−8).

An implementation using hardcoded offsets — or assuming "March is winter, so PST" — shifts Sara's
entire window by one hour and reports wrong local times for her in every single result, silently.
For completeness: `Europe/London` shifts on 29 Mar and `Australia/Sydney` on 5 Apr; both fall
outside this window, but the implementation must generalise to them rather than special-casing March.

I'm treating this as a deliberate part of the exercise, so timezone correctness gets a real library
and dedicated regression tests rather than arithmetic.

## 3. Core design decision

> **All internal reasoning happens on absolute instants (UTC epoch milliseconds). Local wall-clock
> time exists only at the two edges — parsing input and rendering output.**

Every timezone bug I've seen comes from mixing the two representations in the middle of the logic.
Converting once on the way in and once on the way out makes DST correctness structural instead of
something to patch case by case. Interval math then becomes plain integer comparison, which is
trivially testable.

## 4. Architecture

Next.js (App Router) + TypeScript — backend routes and UI in one deployable unit. Chosen so the
whole thing is a single Vercel deploy with no CORS or cross-service coordination inside a 4-hour box.

```
src/lib/scheduling/     <- pure domain logic, zero I/O, fully unit tested
  intervals.ts            interval algebra: merge, intersect, subtract, clip
  availability.ts         recurring local hours -> UTC intervals, minus busy blocks
  solver.ts               candidate sweep, coverage ranking, contiguous-run merging
  diagnose.ts             why no full match; split-meeting cover; stretch cost
src/app/api/            <- thin HTTP layer: validate, call domain, serialise
src/app/                <- UI
```

The domain layer is deliberately free of framework and I/O concerns. It takes data, returns data.
That's what makes it testable and what would let it move to a queue, a cron job, or a different
framework unchanged.

**Libraries:** `luxon` for IANA/DST-correct conversion (never manual offset arithmetic);
`zod` for validating every API boundary; `vitest` for the domain tests.

## 5. The algorithm

1. **Expand** — turn each participant's recurring local hours into concrete per-day intervals in
   their own zone, converted to UTC.
2. **Subtract** — remove pre-existing meetings, yielding genuinely free intervals.
3. **Sweep** — step a candidate window across the range (15-min grid) and, at each position, collect
   the participants who are free for the *entire* requested duration.
4. **Merge** — collapse consecutive candidates sharing an identical attendee set into a single
   continuous range. Without this the UI is dozens of near-duplicate rows offset by 15 minutes;
   with it, one row reads "Tue 13:00–17:00 — Tom + Sara".
5. **Rank** — attendee count descending, then a penalty for sitting at the very edge of someone's
   working day, then earliest first.

Granularity is a parameter, not a constant. 15 minutes matches how people actually book meetings.

## 6. When no slot fits everyone

The response is designed so the coordinator always has a decision to make. Three components:

**a. Best-effort slots.** Maximum-coverage options, each naming who cannot attend *and why*, in
human terms — "75 minutes before Sara's 06:00 start", or "conflicts with 'Standup'".

**b. A split plan.** The minimum set of meetings that covers everyone **with nobody outside their
normal hours**. For this dataset that is exactly two meetings, and it is the answer a real
coordinator wants:

| Meeting | Attendees | Local times |
|---|---|---|
| Tue 10 Mar, 04:00 UTC | Maya + Jack | Maya 09:30, Jack 15:00 |
| Tue 10 Mar, 14:00 UTC | Tom + Sara | Tom 14:00, Sara 07:00 |

**c. A diagnosis.** Computed from the data, not hardcoded: which pair blocks the group and why.
Plus the honest cost of forcing a single all-hands anyway — the cheapest such slot requires Sara at
03:00 and Jack at 21:00, roughly **5h45m of combined out-of-hours time**. Surfacing that number lets
the coordinator reject the idea on evidence instead of instinct.

I considered auto-suggesting "shift someone's hours permanently" and rejected it: that's an
organisational decision, not a scheduling one, and the tool shouldn't imply authority it lacks.

## 7. API

- `POST /api/schedule/suggest` — `{ participants, durationMinutes, from, to, granularityMinutes? }`
  → `{ fullMatches, bestEffort, splitPlan, diagnosis }`
- `GET | POST /api/participants` — read the participant list / add a participant, with validation.
  Pre-seeded with the four people from the brief so the app is usable on first load.

Every returned slot carries, per participant: local start/end, zone abbreviation, an availability
flag, and a human-readable reason when unavailable. The UI should not need to recompute anything —
if the UI had to redo timezone math, that logic would inevitably drift from the backend's.

## 8. Persistence — a deliberate trade-off

The scheduling API is a **pure stateless function**: the participant list is supplied in the request
body. The client owns that list and persists it to `localStorage` behind a `ParticipantRepository`
interface.

Reasoning: serverless functions have no reliable cross-invocation memory, so in-process state would
be quietly broken in production — worse than no persistence. A real database is the correct answer
for a real deployment but not a defensible use of a 4-hour budget when the graded substance is the
scheduling logic. The repository interface is the seam; swapping in Postgres touches one file and no
domain code. This is a known limitation, recorded rather than hidden.

## 9. Testing

Tests target the domain layer, where the risk actually is:

- Interval algebra edge cases — touching, nested, zero-length, adjacent.
- **Sara resolves to PDT (UTC−7) on 9 Mar 2026** — the direct regression test for the DST trap.
- Jack's window correctly wrapping across the UTC date boundary.
- A golden test asserting the full dataset yields **zero** full matches and **exactly** the three
  two-person ranges listed in §1.
- Busy blocks correctly subtracting from availability.

## 10. Scope

**Building:** participant management (zone, hours, existing meetings), slot search, per-participant
local rendering, the no-match fallback, validation, domain tests, deployment.

**Knowingly not building:** authentication, a database, calendar integration (Google/Outlook),
recurring meetings, per-day differing hours, invitations. These are breadth. The brief asks for
depth, so the budget goes into the scheduling engine being correct and the no-match case being
genuinely useful.

## 11. Sequence

PLAN.md committed first → domain engine with tests → API → UI → README → deploy. Domain before HTTP
before UI, so the layer everything else depends on is proven before anything is built on top of it.
