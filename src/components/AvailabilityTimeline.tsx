/**
 * Everyone's working day drawn against one 24-hour UTC axis.
 *
 * The rest of the app states the overlap in words - "Sara (13:00-22:00 UTC) and
 * Jack (23:00-08:00 UTC) never overlap". That is precise and asks the reader to
 * take it on trust. Drawn on a shared scale the same fact is immediate: no
 * vertical line passes through every bar, and the gap between the two ends of
 * the day is plainly visible.
 *
 * It is shown for a successful search too, where it makes the opposite point -
 * the column of bars the suggested time passes through.
 */

import type { TimelineWindow } from "@/lib/scheduling/types";

const MINUTES_IN_DAY = 24 * 60;
const AXIS_HOURS = [0, 6, 12, 18, 24];

const percent = (minutes: number) => (minutes / MINUTES_IN_DAY) * 100;

/**
 * A window as one or two drawable segments.
 *
 * A day whose end is at or before its start has crossed UTC midnight, so it
 * draws as a piece at each end of the axis rather than wrapping invisibly.
 * Sydney is the usual case: 23:00 one day to 08:00 the next.
 */
function segmentsFor(window: TimelineWindow): { left: number; width: number }[] {
  const { utcStartMinute, utcEndMinute } = window;

  if (utcEndMinute > utcStartMinute) {
    return [{ left: percent(utcStartMinute), width: percent(utcEndMinute - utcStartMinute) }];
  }

  return [
    { left: percent(utcStartMinute), width: percent(MINUTES_IN_DAY - utcStartMinute) },
    { left: 0, width: percent(utcEndMinute) },
  ];
}

interface AvailabilityTimelineProps {
  windows: TimelineWindow[];
  /** Optional UTC minute range to mark, typically the recommended slot. */
  highlight?: { startMinute: number; endMinute: number };
}

export function AvailabilityTimeline({ windows, highlight }: AvailabilityTimelineProps) {
  if (windows.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-label="Working hours across participants, in UTC"
    >
      <header className="mb-3">
        <h2 className="font-semibold">Working hours, side by side</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Everyone&apos;s day on one UTC scale. A meeting is possible wherever the bars line up.
        </p>
      </header>

      <div className="space-y-1.5">
        {windows.map((window) => (
          <div key={window.participantId} className="flex items-center gap-3">
            <div className="w-24 shrink-0 truncate text-sm sm:w-32">
              <span className="font-medium">{window.name}</span>
            </div>

            <div className="relative h-7 grow overflow-hidden rounded-md bg-[var(--background)]">
              {/* Hour gridlines, so a bar can be read against the axis rather
                  than only compared with its neighbours. */}
              {AXIS_HOURS.slice(1, -1).map((hour) => (
                <div
                  key={hour}
                  className="absolute top-0 bottom-0 w-px bg-[var(--border)]"
                  style={{ left: `${percent(hour * 60)}%` }}
                />
              ))}

              {segmentsFor(window).map((segment, index) => (
                <div
                  key={index}
                  className="absolute top-1 bottom-1 rounded bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/30"
                  style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                />
              ))}

              {highlight && (
                <div
                  className="absolute top-0 bottom-0 bg-[var(--ok)]/25 ring-1 ring-[var(--ok)]"
                  style={{
                    left: `${percent(highlight.startMinute)}%`,
                    width: `${Math.max(percent(highlight.endMinute - highlight.startMinute), 0.6)}%`,
                  }}
                />
              )}
            </div>

            <div className="tabular w-24 shrink-0 text-right text-xs text-[var(--muted)] sm:w-28">
              {window.localStart}–{window.localEnd} local
            </div>
          </div>
        ))}
      </div>

      {/* Axis sits below the bars and is aligned to the same track by matching
          the label column widths above. */}
      <div className="mt-2 flex items-center gap-3" aria-hidden="true">
        <div className="w-24 shrink-0 sm:w-32" />
        <div className="relative h-4 grow">
          {AXIS_HOURS.map((hour) => (
            <span
              key={hour}
              className="tabular absolute text-[10px] text-[var(--muted)]"
              style={{
                left: `${percent(hour * 60)}%`,
                transform:
                  hour === 0 ? "none" : hour === 24 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        <div className="w-24 shrink-0 sm:w-28" />
      </div>

      <p className="mt-2 text-xs text-[var(--muted)]">
        Times along the axis are UTC. A bar reaching both edges is a working day that crosses UTC
        midnight.
      </p>
    </section>
  );
}
