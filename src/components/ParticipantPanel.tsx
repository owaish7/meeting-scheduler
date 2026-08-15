"use client";

/**
 * The participant list and the form for adding to it.
 *
 * Time zones are chosen from the browser's own IANA list rather than typed, since
 * a mistyped zone is the single easiest way to get silently wrong results, and
 * "Asia/Bangalore" looks entirely plausible until it fails.
 */

import { useMemo, useState } from "react";
import type { Participant, Weekday } from "@/lib/scheduling/types";
import { WEEKDAYS } from "@/lib/scheduling/types";

/** Every zone the runtime knows about, with a sensible fallback for older engines. */
function supportedTimeZones(): string[] {
  const withValues = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = withValues.supportedValuesOf?.("timeZone");
  if (zones?.length) return zones;

  return [
    "Asia/Kolkata",
    "Europe/London",
    "America/Los_Angeles",
    "America/New_York",
    "Australia/Sydney",
    "UTC",
  ];
}

/**
 * Weekday toggles.
 *
 * The single-letter labels are ambiguous on their own - two Ts and two Ss, told
 * apart only by position - and a screen reader would otherwise announce these
 * buttons as just "T". The full name is carried alongside for the accessible
 * name and the tooltip, so the compact label is a visual shorthand rather than
 * the only way to tell the days apart.
 */
const DAY_LABELS: { value: Weekday; label: string; name: string }[] = [
  { value: 1, label: "M", name: "Monday" },
  { value: 2, label: "T", name: "Tuesday" },
  { value: 3, label: "W", name: "Wednesday" },
  { value: 4, label: "T", name: "Thursday" },
  { value: 5, label: "F", name: "Friday" },
  { value: 6, label: "S", name: "Saturday" },
  { value: 7, label: "S", name: "Sunday" },
];

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

interface ParticipantPanelProps {
  participants: Participant[];
  onAdd: (participant: Participant) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
}

export function ParticipantPanel({
  participants,
  onAdd,
  onRemove,
  onReset,
}: ParticipantPanelProps) {
  const zones = useMemo(() => supportedTimeZones(), []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [timeZone, setTimeZone] = useState("Europe/London");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [days, setDays] = useState<Weekday[]>(WEEKDAYS);

  function toggleDay(day: Weekday) {
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  function reset() {
    setName("");
    setLocation("");
    setStart("09:00");
    setEnd("17:00");
    setDays(WEEKDAYS);
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) return setError("Name is required");
    if (days.length === 0) return setError("Select at least one working day");
    if (start === end) return setError("Start and end times cannot be identical");

    onAdd({
      // Suffixed with a timestamp so two people can share a first name.
      id: `${name.trim().toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name: name.trim(),
      location: location.trim() || timeZone.split("/").pop()!.replace(/_/g, " "),
      timeZone,
      workingHours: { start, end, days },
      busy: [],
    });

    reset();
    setOpen(false);
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">Participants</h2>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
        >
          Reset to sample team
        </button>
      </header>

      {/* Bounded once the list outgrows the space it deserves, so a large team
          cannot push the rest of the page out of reach. */}
      <ul
        className={`space-y-1.5 ${
          participants.length > 8 ? "max-h-96 overflow-y-auto pr-1" : ""
        }`}
      >
        {participants.map((participant) => (
          <li
            key={participant.id}
            className="flex items-baseline justify-between gap-2 rounded-md bg-[var(--background)] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="font-medium">{participant.name}</div>
              {/* City and zone identifier on separate lines rather than a single
                  truncated one: "America/Los..." hides exactly the detail this
                  app exists to get right. */}
              <div className="text-xs text-[var(--muted)]">{participant.location}</div>
              <div className="text-xs break-all text-[var(--muted)]">{participant.timeZone}</div>
            </div>

            <div className="flex shrink-0 items-baseline gap-3">
              <span className="tabular text-sm text-[var(--muted)]">
                {participant.workingHours.start}–{participant.workingHours.end}
              </span>
              <button
                type="button"
                onClick={() => onRemove(participant.id)}
                aria-label={`Remove ${participant.name}`}
                className="text-[var(--muted)] hover:text-[var(--warn)]"
              >
                ×
              </button>
            </div>
          </li>
        ))}

        {participants.length === 0 && (
          <li className="rounded-md bg-[var(--background)] px-3 py-4 text-center text-sm text-[var(--muted)]">
            No participants yet.
          </li>
        )}
      </ul>

      {open ? (
        <form onSubmit={submit} className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-[var(--muted)]">
              Name
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya"
                autoFocus
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Location
              <input
                className={inputClass}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="block text-xs text-[var(--muted)]">
            Time zone
            <select
              className={inputClass}
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-[var(--muted)]">
              Available from
              <input
                type="time"
                className={inputClass}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              until
              <input
                type="time"
                className={inputClass}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>

          <div role="group" aria-labelledby="working-days-label">
            <span id="working-days-label" className="text-xs text-[var(--muted)]">
              Working days
            </span>
            <div className="mt-1 flex gap-1">
              {DAY_LABELS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                  aria-pressed={days.includes(day.value)}
                  aria-label={day.name}
                  title={day.name}
                  className={`h-8 w-8 rounded-md border text-xs font-medium focus:border-[var(--accent)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)] ${
                    days.includes(day.value)
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {/* Hidden from assistive tech: aria-label carries the full name. */}
                  <span aria-hidden="true">{day.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Announced on appearance, so the reason a submit did nothing is not
              only conveyed visually. */}
          {error && (
            <p role="alert" className="text-xs text-[var(--warn)]">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              Add participant
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-md border border-dashed border-[var(--border)] py-2 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          + Add participant
        </button>
      )}
    </section>
  );
}
