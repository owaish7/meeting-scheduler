/**
 * One suggested meeting time, shown in every participant's local time.
 *
 * Everyone is listed, not just the people who can attend. When no slot suits the
 * whole group - which is the case for the team in the brief - who is missing and
 * why is the information the coordinator actually needs, so it belongs on the
 * card rather than hidden behind an interaction.
 */

import type { ParticipantSlotView, Slot } from "@/lib/scheduling/types";

function utcLabel(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ParticipantRow({ view }: { view: ParticipantSlotView }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 rounded-md px-3 py-2 ${
        view.available ? "bg-[var(--ok-soft)]" : "bg-[var(--background)]"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{view.name}</span>
          <span className="truncate text-xs text-[var(--muted)]">{view.location}</span>
        </div>
        {view.reason && (
          <div className="mt-0.5 text-xs text-[var(--warn)]">{view.reason}</div>
        )}
      </div>

      <div className="shrink-0 text-right">
        <div
          className={`tabular text-sm font-semibold ${
            view.available ? "text-[var(--ok)]" : "text-[var(--muted)] line-through decoration-1"
          }`}
        >
          {view.localStart}–{view.localEnd}
        </div>
        <div className="tabular text-xs text-[var(--muted)]">
          {view.localDate} · {view.zoneAbbreviation}
        </div>
      </div>
    </div>
  );
}

interface SlotCardProps {
  slot: Slot;
  /** Optional heading shown above the time, e.g. "Meeting 1 of 2". */
  label?: string;
}

export function SlotCard({ slot, label }: SlotCardProps) {
  // A run covers a range of equally valid starts; showing that range tells the
  // coordinator how much room they have to move the meeting.
  const isFlexible = slot.earliestStartUtc !== slot.latestStartUtc;

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          {label && (
            <div className="text-xs font-medium tracking-wide text-[var(--accent)] uppercase">
              {label}
            </div>
          )}
          <h3 className="tabular text-base font-semibold">{utcLabel(slot.startUtc)} UTC</h3>
          {isFlexible && (
            <p className="tabular mt-0.5 text-xs text-[var(--muted)]">
              Can start anytime {timeOnly(slot.earliestStartUtc)}–{timeOnly(slot.latestStartUtc)} UTC
            </p>
          )}
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            slot.isFullMatch
              ? "bg-[var(--ok-soft)] text-[var(--ok)]"
              : "bg-[var(--warn-soft)] text-[var(--warn)]"
          }`}
        >
          {slot.attendeeCount} of {slot.totalParticipants} available
        </span>
      </header>

      <div className="space-y-1.5">
        {slot.participants.map((view) => (
          <ParticipantRow key={view.participantId} view={view} />
        ))}
      </div>
    </article>
  );
}
