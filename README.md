# Meeting Scheduler

Finds meeting times across time zones for a distributed team — and returns something
useful when no single time works for everyone.

Built for the Fenmo technical assessment. `PLAN.md` was written and committed before any
application code and records the reasoning behind the decisions summarised here.

---

## The problem, and what the app actually does

The brief supplies four people and asks for a 45-minute slot during 8–14 March 2026:

| Person | Location | Available (local) |
|---|---|---|
| Maya | Bangalore | 09:00–18:00 |
| Tom | London | 08:00–17:00 |
| Sara | San Francisco | 06:00–15:00 |
| Jack | Sydney | 10:00–19:00 |

**There is no such slot.** Converted to a single absolute timeline, Sara's earliest start
(13:00 UTC) falls after Jack's latest end (08:00 UTC), so those two can never share a
working minute — on any day, at any duration. The most any single meeting can reach is
**two of the four**.

Returning an empty list would be correct and useless, so the app answers with three things
instead:

1. **A split plan** — the fewest meetings that cover everyone with nobody outside their
   normal hours. Here that is two meetings: Maya + Jack, and Tom + Sara.
2. **The best single meeting** — highest-coverage options, each naming who is missing and
   why ("8h 30m before their 06:00 start").
3. **A diagnosis** — which pairs are structurally incompatible, and what forcing a single
   all-hands would actually cost: **5h 45m** of out-of-hours time across the group, with one
   person carrying 3h of it. Stated as a fact so the coordinator can reject the idea on
   evidence. Deciding who absorbs that is not the scheduler's call.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. The four participants from the brief are pre-loaded and the
date range defaults to the week in question, so the scenario above is one click away.

```bash
npm test        # 52 tests covering the scheduling engine
npm run build   # production build
```

## Decisions

**Everything internal is an absolute instant; local time exists only at the edges.**
Wall-clock times are converted to epoch milliseconds on the way in and rendered back on the
way out, and nothing in between reasons about time zones. Overlap detection is then plain
integer arithmetic that can be tested exhaustively. Most time-zone bugs come from mixing the
two representations mid-logic; this makes that structurally difficult.

**Luxon, and never manual offset arithmetic.** The requested week begins on 8 March 2026,
the exact day US daylight saving starts, so San Francisco is on **PDT (UTC−7)** and not PST.
Hardcoded offsets — or assuming March is still winter — shift Sara's entire window by an
hour and silently corrupt every result involving her. There is a regression test pinning
this, plus one pinning PST correctness before the transition.

**The API resolves every participant's local time server-side.** The client renders what it
is given and performs no date maths. If the UI recomputed local times, that logic would
eventually drift from the backend's.

**Contiguous results are merged.** A four-hour window at 15-minute granularity would
otherwise produce sixteen near-identical rows. One row reading "13:00–17:00, Tom + Sara"
is what a coordinator can use; the flexible range is shown on the card.

**Slots are recommended from inside the window, not at its edge.** Taking the earliest valid
start reliably produces the worst one — flush against the opening of somebody's day. Each
run is scanned for the position with the most room either side, which is why the app suggests
Maya at 10:00 rather than 09:00.

**Minimum cover is computed exactly, not greedily.** Greedy set cover gets this dataset
wrong: it takes Maya + Tom first, then needs two more meetings for Sara and Jack, who cannot
share one — three meetings where two suffice. A breadth-first search over attendee bitmasks
is exact and costs nothing at this scale, with a greedy fallback above 16 participants.

**Validation lives at the boundary.** Zod validates every request, checking time zones
against the real IANA database rather than a pattern — "Asia/Bangalore" is well-formed and
does not exist. The domain layer can then assume well-formed input.

### Persistence — a deliberate trade-off

The scheduling API is a **pure stateless function**: participants are supplied in the request
body, and the browser owns the list via `localStorage`.

Serverless instances cannot reliably share in-process memory, so server-side in-memory state
would be quietly broken in production — worse than none. A real database is the right answer
for a real deployment, but not the best use of a fixed time budget when the scheduling logic
is the substance of the exercise. `ParticipantRepository` in `src/lib/repository.ts` is the
seam: adding a database means writing one more implementation of that interface, with no
change to the domain layer or the UI.

## Layout

```
src/lib/scheduling/     Pure domain logic — no I/O, no framework, fully unit tested
  intervals.ts            Interval algebra: merge, intersect, subtract, clip
  availability.ts         Local recurring hours -> absolute intervals, minus busy blocks
  solver.ts               Candidate sweep, contiguous-run merging, ranking
  diagnose.ts             Blocking pairs, minimum-cover split plan, forced-meeting cost
  suggest.ts              Entry point
src/lib/api/schema.ts   Zod request validation
src/app/api/            Thin HTTP layer: validate, delegate, serialise
src/components/         UI
```

The domain layer takes data and returns data. That is what makes it testable, and what would
let it move behind a queue or a scheduled job unchanged.

## API

**`POST /api/schedule/suggest`**

```jsonc
{
  "participants": [ /* id, name, location, timeZone, workingHours, busy */ ],
  "durationMinutes": 45,
  "from": "2026-03-08",   // inclusive
  "to": "2026-03-14",     // inclusive
  "granularityMinutes": 15,
  "maxResults": 20
}
```

Returns `fullMatches`, and when that is empty, `bestEffort`, `splitPlan` and `diagnosis`.
Every slot carries each participant's local date, start, end, zone abbreviation, and a
human-readable reason when they cannot attend.

**`GET /api/participants`** returns the seed team. **`POST /api/participants`** validates a
participant, so validation rules live in one place rather than being duplicated client-side.

## Tests

52 tests, aimed at the domain layer where the risk is:

- Interval algebra edge cases — touching, nested, zero-length, adjacent, split-by-hole.
- Sara resolves to PDT on 9 March 2026 and PST on 9 February 2026.
- Sydney windows that begin on the previous UTC day.
- Overnight working hours that cross local midnight.
- A golden test asserting the brief's dataset yields zero full matches, exactly the three
  viable pairings, and a two-meeting split plan covering everyone.
- Pre-existing meetings correctly subtracting from availability.

The golden test's expectations were derived by an independent exhaustive sweep before the
solver was written, so they pin the real answer rather than the implementation's opinion.

## Knowingly unfinished

- **No database.** Participants live in the browser. Reasoning above; the seam is in place.
- **No authentication.** Anyone with the URL can use it. It is an internal coordinator tool
  with no stored data worth protecting.
- **No calendar integration.** Pre-existing meetings are entered as data and supported by the
  engine and the API, but the UI has no form for adding them — the seeded team has none, and
  building that form was worth less than getting the no-match path right. Busy blocks sent
  directly to the API are honoured and tested.
- **One working-hours window per participant.** No per-day variation, and no split days
  (a lunch break, for example). The interval algebra already supports multiple windows;
  only the input model assumes one.
- **No recurring meetings, invitations, or notifications.** Out of scope by choice — the
  brief asks for depth over breadth.
- **Fixed light theme.** Predictable contrast was preferred over following the system theme
  for a tool where several people compare the same times side by side.
