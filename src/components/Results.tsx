/**
 * Renders a scheduling result.
 *
 * The important case is the one where nothing fits. For the team in the brief no
 * 45-minute slot covers all four on any day, so the failure path is the one a
 * coordinator will actually spend time in: it leads with what is wrong, then a
 * plan that covers everyone, and only then the individual partial options.
 */

import type { SuggestResponse } from "@/lib/scheduling/types";
import { AvailabilityTimeline } from "./AvailabilityTimeline";
import { SlotCard } from "./SlotCard";

/** Blocking pairs shown before the rest are folded away. */
const MAX_LISTED_BLOCKERS = 4;

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * One headline number from the diagnosis.
 *
 * The answer a coordinator wants - how many of the group can actually be in one
 * room - was previously a clause in the middle of a paragraph. Three numbers
 * lead instead, and the prose becomes support rather than the delivery vehicle.
 *
 * The value uses the font's proportional figures rather than tabular ones: at
 * this size `tabular-nums` gives every digit the width of a zero and reads
 * loose. Tabular figures are for columns that must align, which these are not.
 */
function StatTile({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md border border-[color:var(--warn)]/20 bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[11px] font-medium tracking-wide text-[var(--muted)] uppercase">
        {label}
      </div>
      <div
        className={`mt-0.5 text-2xl leading-tight font-semibold ${
          emphasis ? "text-[var(--warn)]" : "text-[var(--foreground)]"
        }`}
      >
        {value}
      </div>
      {detail && <div className="mt-0.5 text-xs text-[var(--muted)]">{detail}</div>}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function Results({ result }: { result: SuggestResponse }) {
  const { fullMatches, bestEffort, splitPlan, diagnosis, timeline, meta } = result;

  /*
   * The split plan is assembled from the same options as the best-effort list,
   * so its meetings would otherwise appear twice on the page - once as the
   * recommendation and again below it as an "alternative" to itself. Only the
   * options the plan did not use are genuine alternatives.
   *
   * Filtered here rather than in the API: the response is complete and its two
   * lists are independently meaningful, and which of them to show is a
   * presentation decision.
   */
  const plannedStarts = new Set(splitPlan?.meetings.map((meeting) => meeting.slot.startUtc) ?? []);
  const otherOptions = bestEffort.filter((slot) => !plannedStarts.has(slot.startUtc));
  const hasPlan = Boolean(splitPlan && splitPlan.meetings.length > 0);
  const bestCoverage = bestEffort[0]?.attendeeCount ?? 0;

  if (fullMatches.length > 0) {
    return (
      <section className="space-y-6">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--ok-soft)] p-4">
          <h2 className="font-semibold text-[var(--ok)]">
            {fullMatches.length === 1
              ? "1 time works for everyone"
              : `${fullMatches.length} times work for everyone`}
          </h2>
          <p className="mt-1 text-sm text-[var(--ok)]">
            Every participant is inside their normal hours, with no clashes.
          </p>
        </div>

        {/* No timeline here. When a time works for everyone the card already
            says so in each participant's own hours; drawing the overlap as well
            would restate an answer the reader has. It earns its place only when
            the answer is "no" and the reason needs showing. */}
        <div className="space-y-3">
          {fullMatches.map((slot) => (
            <SlotCard key={slot.startUtc} slot={slot} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      {/* An empty list would be a correct answer and a useless one, so the
          explanation comes first and the alternatives immediately after. */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--warn-soft)] p-4">
        <h2 className="font-semibold text-[var(--warn)]">
          No single time works for all {meta.participantCount}
        </h2>
        {diagnosis && (
          <>
            {/* The three numbers that answer "so what do I do?", before any prose. */}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <StatTile
                label="Best single meeting"
                value={`${bestCoverage} of ${meta.participantCount}`}
                detail="the most one meeting can reach"
                emphasis
              />
              {hasPlan && (
                <StatTile
                  label="To include everyone"
                  value={
                    splitPlan!.meetings.length === 1
                      ? "1 meeting"
                      : `${splitPlan!.meetings.length} meetings`
                  }
                  detail="nobody outside their hours"
                />
              )}
              {diagnosis.forcedOption && (
                <StatTile
                  label="If forced into one"
                  value={formatDuration(diagnosis.forcedOption.totalStretchMinutes)}
                  detail={`out-of-hours time, ${formatDuration(
                    diagnosis.forcedOption.worstStretchMinutes,
                  )} on one person`}
                />
              )}
            </div>

            {diagnosis.blockingPairs.length > 0 && (
              // Demoted to a disclosure: it is the reasoning behind the numbers
              // above, wanted on challenge rather than on arrival.
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--warn)]">
                  Why:{" "}
                  {diagnosis.blockingPairs.length === 1
                    ? "1 pair never overlaps"
                    : `${diagnosis.blockingPairs.length} pairs never overlap`}
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-[var(--warn)]">
                  {diagnosis.blockingPairs.slice(0, MAX_LISTED_BLOCKERS).map((pair) => (
                    <li key={`${pair.aId}-${pair.bId}`}>{pair.explanation}</li>
                  ))}
                </ul>

                {/* Pair count grows quadratically with the group, so a large team
                    would otherwise bury the banner under a list of them. */}
                {diagnosis.blockingPairs.length > MAX_LISTED_BLOCKERS && (
                  <p className="mt-1.5 text-xs text-[var(--warn)] opacity-80">
                    and {diagnosis.blockingPairs.length - MAX_LISTED_BLOCKERS} more
                  </p>
                )}
              </details>
            )}
          </>
        )}
      </div>

      {/* Placed immediately after the explanation: it is the same finding drawn
          rather than described, and shows at a glance that no vertical line
          crosses every bar. */}
      <AvailabilityTimeline windows={timeline} />

      {splitPlan && splitPlan.meetings.length > 0 && (
        <div>
          <SectionHeading
            title={`Suggested: split into ${splitPlan.meetings.length} meetings`}
            hint={
              splitPlan.uncoveredParticipantIds.length === 0
                ? "Covers everyone, with nobody working outside their normal hours."
                : "Covers as many people as their working hours allow."
            }
          />
          <div className="space-y-3">
            {splitPlan.meetings.map((meeting, index) => (
              <SlotCard
                key={meeting.slot.startUtc}
                slot={meeting.slot}
                label={`Meeting ${index + 1} of ${splitPlan.meetings.length}`}
              />
            ))}
          </div>
        </div>
      )}

      {otherOptions.length > 0 && (
        <div>
          <SectionHeading
            title={hasPlan ? "Other options" : "Best single meeting"}
            hint={
              hasPlan
                ? `Instead of the plan above. A single ${formatDuration(meta.durationMinutes)} meeting reaches at most ${bestEffort[0].attendeeCount} of ${meta.participantCount}.`
                : `The most people a single ${formatDuration(meta.durationMinutes)} meeting can reach is ${bestEffort[0].attendeeCount} of ${meta.participantCount}.`
            }
          />
          <div className="space-y-3">
            {otherOptions.map((slot) => (
              <SlotCard key={slot.startUtc} slot={slot} />
            ))}
          </div>
        </div>
      )}

      {bestEffort.length === 0 && (
        <p className="text-sm text-[var(--muted)]">
          No participant is available for {formatDuration(meta.durationMinutes)} anywhere in this
          range. Try a shorter meeting or a wider set of dates.
        </p>
      )}
    </section>
  );
}
