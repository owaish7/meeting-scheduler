"use client";

/**
 * The coordinator's screen.
 *
 * State lives here and is persisted through `participantRepository`; all
 * scheduling is done by the API. The client deliberately performs no time-zone
 * arithmetic of its own - every local time on screen was resolved server-side, so
 * there is only one implementation of that logic to keep correct.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import { ParticipantPanel } from "@/components/ParticipantPanel";
import { Results } from "@/components/Results";
import { participantRepository } from "@/lib/repository";
import { DEFAULT_DURATION_MINUTES, DEFAULT_RANGE } from "@/lib/seed";
import type { Participant, SuggestResponse } from "@/lib/scheduling/types";

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];

/** "90" -> "1h 30m". Plain minutes read poorly once past an hour. */
function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 1 ? "1 hour" : `${hours} hours`;
  return rest === 0 ? hourPart : `${hourPart} ${rest}m`;
}

const controlClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

export default function Home() {
  // Read through the store rather than copied into local state, so there is one
  // source of truth and no effect that re-renders the list after mounting.
  const participants = useSyncExternalStore(
    participantRepository.subscribe,
    participantRepository.getSnapshot,
    participantRepository.getServerSnapshot,
  );

  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [from, setFrom] = useState(DEFAULT_RANGE.from);
  const [to, setTo] = useState(DEFAULT_RANGE.to);

  const [result, setResult] = useState<SuggestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Apply a change to the participant list.
   *
   * Takes an updater and reads the store at call time rather than accepting a
   * finished array. A pre-built array would be derived from the list captured at
   * render, so two changes in quick succession would both start from the same
   * snapshot and the first would be silently lost.
   */
  const updateParticipants = useCallback((update: (current: Participant[]) => Participant[]) => {
    participantRepository.save(update(participantRepository.getSnapshot()));
    // Any change to the list invalidates the current answer; showing stale
    // results beside an edited participant list would be actively misleading.
    setResult(null);
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/schedule/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants, durationMinutes, from, to, maxResults: 20 }),
      });

      const payload = await response.json();
      if (!response.ok) {
        const fields = payload.fields ? Object.values(payload.fields).join(". ") : null;
        throw new Error(fields || payload.error || "Could not find meeting times");
      }

      setResult(payload as SuggestResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [participants, durationMinutes, from, to]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Meeting Scheduler</h1>
        <p className="mt-1 text-[var(--muted)]">
          Find a time that works across time zones — and something useful when none does.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
        {/*
         * Stacked on narrow screens, the participant list pushes the controls and
         * results more than a screen down the page, so the ordering flips: search
         * first, roster below. Side by side there is no such competition, and the
         * roster returns to the left where it reads as context for the results.
         */}
        <div className="order-2 space-y-4 lg:sticky lg:top-6 lg:order-1">
          <ParticipantPanel
            participants={participants}
            onAdd={(participant) => updateParticipants((current) => [...current, participant])}
            onRemove={(id) => updateParticipants((current) => current.filter((p) => p.id !== id))}
            onReset={() => {
              participantRepository.reset();
              setResult(null);
            }}
          />
        </div>

        <div className="order-1 space-y-6 lg:order-2">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-[var(--muted)]">
                Meeting length
                <select
                  className={`${controlClass} block w-32`}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                >
                  {DURATION_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {durationLabel(minutes)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-[var(--muted)]">
                From
                <input
                  type="date"
                  className={`${controlClass} block`}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>

              <label className="text-xs text-[var(--muted)]">
                To
                <input
                  type="date"
                  className={`${controlClass} block`}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>

              <button
                type="button"
                onClick={search}
                disabled={loading || participants.length === 0}
                className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? "Searching…" : "Find times"}
              </button>
            </div>

            {participants.length === 0 && (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Add at least one participant to search.
              </p>
            )}
          </section>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-[var(--border)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn)]"
            >
              {error}
            </div>
          )}

          {result && !loading && <Results result={result} />}

          {!result && !error && !loading && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted)]">
              Choose a length and date range, then search for times.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
