/**
 * One suggested meeting time, shown in every participant's local time.
 *
 * Everyone is listed, not just the people who can attend - when no slot suits
 * the whole group, who is missing and why is the information the coordinator
 * needs, so it belongs on the card rather than behind an interaction.
 *
 * That stops being true at scale. With a dozen participants a card listing all
 * of them at full size runs past the height of a laptop screen, and the handful
 * who can actually attend get lost among the ten who cannot. So attendees are
 * separated from absentees, the rows flow into columns as width allows, and for
 * larger groups the absentees collapse behind a count that still says how many
 * there are.
 */

import type { ParticipantSlotView, Slot } from "@/lib/scheduling/types";

/** Above this many participants, a card has to earn its vertical space. */
const COMPACT_THRESHOLD = 6;

function utcLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
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

/** "2026-03-10" -> "Tue 10 Mar", for the list of dates an option recurs on. */
function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * One participant's view of the slot.
 *
 * Laid out vertically rather than as a name-and-time row, so it stays readable
 * at any column width instead of squeezing the name as columns narrow.
 */
function ParticipantRow({ view }: { view: ParticipantSlotView }) {
  return (
    <div
      className={`rounded-md px-3 py-2 ${
        view.available ? "bg-[var(--ok-soft)]" : "bg-[var(--background)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{view.name}</span>
        <span
          className={`tabular shrink-0 text-sm font-semibold ${
            view.available ? "text-[var(--ok)]" : "text-[var(--muted)]"
          }`}
        >
          {view.localStart}–{view.localEnd}
        </span>
      </div>

      <div className="tabular mt-0.5 flex items-baseline justify-between gap-2 text-xs text-[var(--muted)]">
        <span className="truncate">{view.location}</span>
        <span className="shrink-0">
          {view.localDate} · {view.zoneAbbreviation}
        </span>
      </div>

      {view.reason && <div className="mt-1 text-xs text-[var(--warn)]">{view.reason}</div>}
    </div>
  );
}

function ParticipantGrid({ views }: { views: ParticipantSlotView[] }) {
  /*
   * Columns rather than one long list: twelve participants become a few rows
   * instead of twelve stacked ones.
   *
   * The track count comes from `auto-fit` rather than fixed breakpoints. A fixed
   * three-column grid leaves empty tracks whenever a group does not divide by
   * three - the brief's four people split into two attending and two missing,
   * so each group sat in two of three columns and left a visible gap on the
   * right. With `auto-fit` the empty tracks collapse and the rows present share
   * the full width, whatever the group size.
   */
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-1.5">
      {views.map((view) => (
        <ParticipantRow key={view.participantId} view={view} />
      ))}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-xs font-medium tracking-wide text-[var(--muted)] uppercase">
      {children}
    </div>
  );
}

interface SlotCardProps {
  slot: Slot;
  /** Optional heading shown above the time, e.g. "Meeting 1 of 2". */
  label?: string;
}

export function SlotCard({ slot, label }: SlotCardProps) {
  const attending = slot.participants.filter((view) => view.available);
  const missing = slot.participants.filter((view) => !view.available);

  // A run covers a range of equally valid starts; showing that range tells the
  // coordinator how much room they have to move the meeting.
  const isFlexible = slot.earliestStartUtc !== slot.latestStartUtc;

  // Small groups keep everyone visible - for the four in the brief, seeing who
  // is missing at a glance is the point of the card.
  const isLargeGroup = slot.participants.length > COMPACT_THRESHOLD;

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
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
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            slot.isFullMatch
              ? "bg-[var(--ok-soft)] text-[var(--ok)]"
              : "bg-[var(--warn-soft)] text-[var(--warn)]"
          }`}
        >
          {slot.attendeeCount} of {slot.totalParticipants} available
        </span>
      </header>

      {attending.length > 0 && (
        <div>
          {isLargeGroup && <GroupLabel>Can attend</GroupLabel>}
          <ParticipantGrid views={attending} />
        </div>
      )}

      {missing.length > 0 &&
        (isLargeGroup ? (
          // Collapsed by default past a certain size, but the count stays visible
          // so the absentees are never silently dropped from the card.
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
              {missing.length} cannot make it
            </summary>
            <div className="mt-2">
              <ParticipantGrid views={missing} />
            </div>
          </details>
        ) : (
          <div className={attending.length > 0 ? "mt-1.5" : ""}>
            <ParticipantGrid views={missing} />
          </div>
        ))}

      {slot.repeatsOn.length > 0 && (
        <p className="mt-3 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--muted)]">
          Also available {slot.repeatsOn.map(dayLabel).join(", ")}
        </p>
      )}
    </article>
  );
}
