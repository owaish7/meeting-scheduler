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
 * Two shapes for two situations, chosen by group size.
 */

/** "the day before" / "the next day", for a local date that is not the UTC one. */
function dayShiftLabel(offset: number): string | null {
  if (offset === 0) return null;
  if (offset === -1) return "previous day";
  if (offset === 1) return "next day";
  return offset < 0 ? `${Math.abs(offset)} days earlier` : `${offset} days later`;
}

const rowSurface = (available: boolean) =>
  `rounded-md px-3 py-2 ${available ? "bg-[var(--ok-soft)]" : "bg-[var(--background)]"}`;

const timeTone = (available: boolean) =>
  `tabular shrink-0 text-sm font-semibold ${
    available ? "text-[var(--ok)]" : "text-[var(--muted)]"
  }`;

/**
 * The reason carries the unavailability - "3h 30m before their 08:00 start"
 * says both that they cannot attend and by how much, so a separate
 * "Unavailable" label would only repeat the first half. The muted background is
 * not the sole channel: the reason is text, and the state is named for
 * assistive tech.
 */
function Reason({ view }: { view: ParticipantSlotView }) {
  if (view.available || !view.reason) return null;

  return (
    <div className="text-xs text-[var(--warn)]">
      <span className="sr-only">Unavailable: </span>
      {view.reason}
    </div>
  );
}

function LocalDate({ view }: { view: ParticipantSlotView }) {
  const shift = dayShiftLabel(view.dayOffset);

  return (
    <>
      {view.localDate} · {view.zoneAbbreviation}
      {/* A local date that is not the meeting's UTC date is correct and reads as
          a bug, so it is called out rather than left to be noticed. */}
      {shift && <span className="text-[var(--accent)]"> ({shift})</span>}
    </>
  );
}

/**
 * Full-width row: name left, time right.
 *
 * The card's job is comparing one instant across people, and right-aligning the
 * times stacks them in a single column the eye can run straight down. Splitting
 * into grid columns breaks that alignment, so this shape is used whenever the
 * group is small enough for height not to be the binding constraint.
 */
function ParticipantListRow({ view }: { view: ParticipantSlotView }) {
  return (
    <div className={rowSurface(view.available)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-medium">{view.name}</span>
        <span className={timeTone(view.available)}>
          {view.localStart}–{view.localEnd}
        </span>
      </div>

      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-[var(--muted)]">
        {/* Full width means the zone identifier never needs truncating, which
            matters here more than anywhere: it is the substance of the app. */}
        <span className="min-w-0">
          {view.location}
          {view.location && " · "}
          {view.timeZone}
        </span>
        <span className="tabular shrink-0 text-right">
          <LocalDate view={view} />
        </span>
      </div>

      <div className="mt-0.5">
        <Reason view={view} />
      </div>
    </div>
  );
}

/**
 * Stacked cell for grid layout.
 *
 * Lays out vertically so it stays readable as columns narrow, at the cost of
 * the shared alignment the list row gives. Used only once a group is large
 * enough that a single column would run off the screen.
 */
function ParticipantCell({ view }: { view: ParticipantSlotView }) {
  return (
    <div className={rowSurface(view.available)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{view.name}</span>
        <span className={timeTone(view.available)}>
          {view.localStart}–{view.localEnd}
        </span>
      </div>

      <div className="tabular mt-0.5 text-right text-xs text-[var(--muted)]">
        <LocalDate view={view} />
      </div>

      <div className="mt-1 text-xs leading-snug text-[var(--muted)]">
        {view.location}
        {view.location && " · "}
        <span className="break-all">{view.timeZone}</span>
      </div>

      <div className="mt-1">
        <Reason view={view} />
      </div>
    </div>
  );
}

/**
 * Render a group of participants in whichever shape suits its size.
 *
 * Small groups keep the full-width list, where the times share one column and
 * can be compared at a glance. Large ones switch to columns, because a dozen
 * stacked rows made cards taller than the screen.
 *
 * The grid's track count comes from `auto-fit` rather than fixed breakpoints: a
 * fixed three-column grid leaves empty tracks whenever a group does not divide
 * by three, which showed up as a gap on the right. `auto-fit` collapses the
 * empty tracks so the rows present share the full width at any group size.
 */
function ParticipantGroup({
  views,
  layout,
}: {
  views: ParticipantSlotView[];
  layout: "list" | "grid";
}) {
  if (layout === "list") {
    return (
      <div className="space-y-1.5">
        {views.map((view) => (
          <ParticipantListRow key={view.participantId} view={view} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-1.5">
      {views.map((view) => (
        <ParticipantCell key={view.participantId} view={view} />
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

  /*
   * One notion of "large group" drives both decisions: past this size the list
   * is replaced by columns, and absentees fold behind a count. Below it the card
   * shows everyone in a single scannable column, which is the shape that suits
   * the four in the brief.
   */
  const isLargeGroup = slot.participants.length > COMPACT_THRESHOLD;
  const layout = isLargeGroup ? "grid" : "list";

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
          <ParticipantGroup views={attending} layout={layout} />
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
              <ParticipantGroup views={missing} layout={layout} />
            </div>
          </details>
        ) : (
          <div className={attending.length > 0 ? "mt-1.5" : ""}>
            <ParticipantGroup views={missing} layout={layout} />
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
