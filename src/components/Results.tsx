/**
 * Renders a scheduling result.
 *
 * The important case is the one where nothing fits. For the team in the brief no
 * 45-minute slot covers all four on any day, so the failure path is the one a
 * coordinator will actually spend time in: it leads with what is wrong, then a
 * plan that covers everyone, and only then the individual partial options.
 */

import type { SuggestResponse } from "@/lib/scheduling/types";
import { SlotCard } from "./SlotCard";

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
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
  const { fullMatches, bestEffort, splitPlan, diagnosis, meta } = result;

  if (fullMatches.length > 0) {
    return (
      <section>
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--ok-soft)] p-4">
          <h2 className="font-semibold text-[var(--ok)]">
            {fullMatches.length === 1
              ? "1 time works for everyone"
              : `${fullMatches.length} times work for everyone`}
          </h2>
          <p className="mt-1 text-sm text-[var(--ok)]">
            Every participant is inside their normal hours, with no clashes.
          </p>
        </div>

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
            <p className="mt-1 text-sm text-[var(--warn)]">{diagnosis.summary}</p>

            {diagnosis.blockingPairs.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-[color:var(--warn)]/20 pt-3 text-sm text-[var(--warn)]">
                {diagnosis.blockingPairs.map((pair) => (
                  <li key={`${pair.aId}-${pair.bId}`}>{pair.explanation}</li>
                ))}
              </ul>
            )}

            {diagnosis.forcedOption && (
              <p className="mt-3 border-t border-[color:var(--warn)]/20 pt-3 text-sm text-[var(--warn)]">
                Forcing everyone into one meeting would cost{" "}
                <strong>{formatDuration(diagnosis.forcedOption.totalStretchMinutes)}</strong> of
                out-of-hours time in total, with one person carrying{" "}
                <strong>{formatDuration(diagnosis.forcedOption.worstStretchMinutes)}</strong> of it.
              </p>
            )}
          </>
        )}
      </div>

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

      {bestEffort.length > 0 && (
        <div>
          <SectionHeading
            title="Best single meeting"
            hint={`The most people a single ${formatDuration(meta.durationMinutes)} meeting can reach is ${bestEffort[0].attendeeCount} of ${meta.participantCount}.`}
          />
          <div className="space-y-3">
            {bestEffort.map((slot) => (
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
