# Meeting Scheduler

Finds meeting times across time zones for a distributed team — and returns something
useful when no single time works for everyone.

`PLAN.md` was written and committed before any application code, and records the
reasoning behind the decisions below.

---

## The problem, and what the app actually does

The brief gives four people and asks for a 45-minute slot during 8–14 March 2026.

**There is no such slot.** Put everyone on one clock and the reason is obvious:

| Person | Location | Local hours | In UTC |
|---|---|---|---|
| Maya | Bangalore | 09:00–18:00 | 03:30–12:30 |
| Tom | London | 08:00–17:00 | 08:00–17:00 |
| Sara | San Francisco | 06:00–15:00 | 13:00–22:00 |
| Jack | Sydney | 10:00–19:00 | 23:00–08:00 *(crosses midnight)* |

Sara starts at 13:00 UTC. Jack finishes at 08:00 UTC. They are never both at their
desk — not on any day, not for any meeting length. The best any single meeting can
do is **2 of the 4**.

An empty screen would be technically correct and completely useless, so the app
answers with four things instead:

1. **The numbers up front** — best single meeting (2 of 4), meetings needed to
   include everyone (2), and what one all-hands would cost (5h 45m of people
   working outside their hours). You get the answer without reading a paragraph.
2. **A split plan** — the fewest meetings that cover everyone with nobody working
   outside their normal hours. Here: Maya + Jack, then Tom + Sara.
3. **A chart of everyone's day on one UTC scale** — you can see that no vertical
   line passes through all four bars, and that Jack's day runs off one end and
   back in the other.
4. **The reasons** — which pairs can never meet, and for any given slot, who is
   missing and by how much ("8h 30m before their 06:00 start"). The cost of
   forcing everyone into one meeting is shown as a fact, so a coordinator can
   rule it out on the numbers. Deciding who takes the 3am call isn't the app's job.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. The four participants from the brief are pre-loaded and the
date range defaults to the week in question, so the scenario above is one click away.

```bash
npm test        # 59 tests covering the scheduling engine
npm run build   # production build
```

## Decisions

**Work in UTC internally. Convert only at the edges.**
Times come in as local wall-clock ("09:00 in Asia/Kolkata"), get converted to a
UTC timestamp immediately, and only get converted back when rendering. Nothing
in between touches time zones. That turns "do these people overlap?" into
comparing numbers, which is easy to test and hard to get subtly wrong.

**Use Luxon. Never do offset maths by hand.**
The requested week starts 8 March 2026 — the day US daylight saving begins. So
San Francisco is on PDT (UTC−7), not PST (UTC−8). Hardcode the offset, or assume
"March is winter", and every time shown for Sara is an hour off. Two tests pin
this: PDT during the week, PST before it.

**The API returns local times already worked out.**
The client just displays what it gets. If the UI did its own date maths, the two
would drift apart eventually — and you'd have two places to fix a bug.

**Merge adjacent results.**
Searching a 4-hour window in 15-minute steps finds 16 valid start times. That's
one option, not sixteen. They collapse into a single result showing the range you
can move it within.

**Collapse options that repeat on other days.**
Working hours are the same every weekday, so a week's search returns the same few
options five times over — 15 results for what is really 3 choices. Each result now
lists the other days it also works on. Time of day is part of the grouping, so if
a daylight-saving change moves an option to a different hour, it stays separate
instead of being lumped in with days it doesn't match.

**Don't suggest a time at the very edge of someone's day.**
The earliest valid start is usually the worst one — it's the minute they log on.
Each option is scanned for the spot with the most room on both sides, capped at an
hour. That's why it suggests 10:00 rather than 09:00. When there's no room to
spare, it just returns the only time that fits.

**Each section on the page answers one question.**
The split plan is built from the same options as the list below it, so those
meetings used to show up twice — once as the recommendation, once as an
"alternative" to itself. The lower section now only shows options the plan didn't
use, and disappears if there aren't any.

**Only show the chart when it explains something.**
The timeline appears when no time works, because that's when you need to see why.
On a successful search it's hidden — the result card already tells you the answer
in everyone's local time.

**Flag a local date that differs from the meeting's date.**
A 04:30 UTC meeting on Monday is Sunday evening in San Francisco. That's correct,
but it looks like a bug, so it's labelled "(previous day)".

**The result card changes shape with group size, not screen size.**
Up to 6 people it's a full-width list, so all the times line up in one column and
you can compare them at a glance. Past 6 that would run off the screen, so it
switches to columns and folds the people who can't attend behind a count.

**A meeting needs at least 2 people.**
Otherwise a group where nobody's hours overlap gets "covered" by a plan of
one-person meetings — technically everyone's included, and completely useless.
If there's no real meeting to suggest, we say so instead.

**Compute the minimum set of meetings exactly, not greedily.**
The standard greedy approach gets this dataset wrong: it picks Maya + Tom first,
then needs two more meetings for Sara and Jack (who can't share one) — three
meetings where two would do. A breadth-first search over the possible groupings
gives the right answer and costs nothing at this size. Greedy is kept as a
fallback above 16 people.

**Validate at the API boundary.**
Zod checks every request, including time zones against the real IANA list — note
that "Asia/Bangalore" looks fine but doesn't exist. Everything downstream can then
assume the data is sane.

### Why there's no database

The scheduling API is a pure function: you send it participants, it sends back
suggestions. It stores nothing. The browser keeps the participant list in
`localStorage`.

Two reasons. Serverless functions don't reliably share memory between requests, so
storing state in the server process would be quietly broken in production — worse
than not storing it at all. And a real database wasn't the best use of a 4-hour
budget when the scheduling logic is the point of the exercise.

`ParticipantRepository` in `src/lib/repository.ts` is the seam. Adding Postgres
means writing one more implementation of that interface — no changes to the
scheduling code or the UI.

## Layout

```
src/lib/scheduling/     The actual scheduling logic. No I/O, no framework, fully tested.
  intervals.ts            Interval maths: merge, intersect, subtract, clip
  availability.ts         Local working hours -> UTC intervals, minus existing meetings
  solver.ts               Searches for slots, merges and ranks them
  diagnose.ts             Why it failed, the split plan, the cost of forcing it
  suggest.ts              Entry point
src/lib/api/schema.ts   Zod validation
src/app/api/            HTTP layer: validate, call the above, return JSON
src/components/         UI
```

The scheduling code takes data and returns data — no database calls, no React, no
`Request` objects. That's what makes it easy to test, and it would work unchanged
behind a queue or a cron job.

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

Returns `fullMatches`. If that's empty, you also get `bestEffort`, `splitPlan` and
`diagnosis`. `timeline` comes back either way — everyone's working day as UTC minutes,
for the chart.

Every slot includes, per participant: their local date and times, the zone abbreviation
for that date, whether their local date differs from the meeting's, and why they can't
make it if they can't.

**`GET /api/participants`** returns the starting team. **`POST /api/participants`**
validates one — so the validation rules live in one place instead of being copied into
the client.

## Tests

59 tests, all aimed at the scheduling logic — that's where the bugs would be.

- Interval maths: intervals that touch, nest, overlap, or get split in half.
- Sara is PDT on 9 March 2026, and PST on 9 February. The daylight-saving check.
- Sydney's working day starting on the previous UTC day.
- Overnight hours (22:00–06:00) that cross local midnight.
- The main one: the brief's four people produce zero full matches, exactly three
  viable pairings, and a two-meeting plan covering everyone.
- Local dates landing a day either side of the meeting's UTC date.
- Repeated options collapsing into one result that lists the other days.
- Two people who can never meet produce no plan, rather than two one-person meetings.
- Existing meetings correctly removed from someone's availability.

The expected numbers in that main test came from a separate brute-force script written
before the solver existed. So they check the real answer, not whatever the code happens
to produce.

## Knowingly unfinished

- **No database.** Participants live in the browser. Reasons above; the seam is in place.
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
