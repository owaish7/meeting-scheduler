"use client";

/**
 * The main screen.
 *
 * State lives here and is saved through `participantRepository`. All the
 * scheduling happens in the API. The client does no time-zone maths of its own -
 * every local time on screen was worked out server-side, so there is only one
 * copy of that logic to keep correct.
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

/** How long to wait before giving up on the API. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Turn a thrown value into something worth showing a user.
 *
 * The three failure modes look identical to `catch` but need different
 * responses: a timeout means try again, an offline browser means check the
 * connection, and a rejected request already carries a message explaining
 * exactly what was wrong with it.
 */
function describeFailure(caught: unknown): string {
  if (caught instanceof DOMException && caught.name === "AbortError") {
    return "That took too long. Try a shorter date range or fewer participants.";
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You appear to be offline. Check your connection and try again.";
  }

  if (caught instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }

  return caught instanceof Error ? caught.message : "Something went wrong.";
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

    // Without a timeout a stalled request leaves the button spinning forever
    // with no way back other than reloading the page.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/schedule/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants, durationMinutes, from, to, maxResults: 20 }),
        signal: controller.signal,
      });

      // A gateway or proxy error returns HTML, not JSON. Parsing it blind throws
      // a syntax error that tells the user nothing about what went wrong.
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // Field errors are the useful ones - they name what was wrong with the
        // request rather than reporting that something was.
        const fields = payload?.fields ? Object.values(payload.fields).join(". ") : null;
        throw new Error(fields || payload?.error || `Request failed (${response.status})`);
      }

      if (!payload) throw new Error("The server sent a response we could not read");

      setResult(payload as SuggestResponse);
    } catch (caught) {
      setError(describeFailure(caught));
      setResult(null);
    } finally {
      clearTimeout(timeout);
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
            onAddMeeting={(participantId, block) =>
              updateParticipants((current) =>
                current.map((p) =>
                  p.id === participantId ? { ...p, busy: [...p.busy, block] } : p,
                ),
              )
            }
            onRemoveMeeting={(participantId, blockId) =>
              updateParticipants((current) =>
                current.map((p) =>
                  p.id === participantId
                    ? { ...p, busy: p.busy.filter((b) => b.id !== blockId) }
                    : p,
                ),
              )
            }
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
