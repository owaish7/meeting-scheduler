/**
 * Where participants are stored.
 *
 * PLAN.md records the reasoning: the scheduling API is a pure function and holds
 * no state, because serverless instances cannot reliably share in-process memory
 * and a real database was not the best use of a fixed time budget when the
 * scheduling logic is what matters. The browser owns the participant list.
 *
 * This interface is the seam that decision was traded against. Swapping in a
 * database means writing one more implementation of `ParticipantRepository`;
 * nothing in the domain layer or the UI needs to know which one it is talking to.
 *
 * The store exposes `subscribe`/`getSnapshot` so React can read it through
 * `useSyncExternalStore`. Loading it inside an effect instead would render the
 * seed list first and then replace it, which both flickers and produces a
 * hydration mismatch when the stored list differs from the seed.
 */

import type { Participant } from "./scheduling/types";
import { SEED_PARTICIPANTS } from "./seed";

export interface ParticipantRepository {
  subscribe(listener: () => void): () => void;
  /** Current list. Referentially stable between writes, as the hook requires. */
  getSnapshot(): Participant[];
  /** What the server renders, before any browser storage is available. */
  getServerSnapshot(): Participant[];
  save(participants: Participant[]): void;
  reset(): void;
}

const STORAGE_KEY = "meeting-scheduler.participants.v1";

export class LocalStorageParticipantRepository implements ParticipantRepository {
  private cache: Participant[] | null = null;
  private listeners = new Set<() => void>();

  /**
   * Read stored participants, falling back to the seed team.
   *
   * Defensive by necessity: `localStorage` is absent during server rendering and
   * in some privacy modes, and its contents are user-editable and may come from
   * an older version of the app. A corrupt entry should return a working default
   * rather than leave a blank screen.
   */
  private read(): Participant[] {
    if (typeof window === "undefined") return SEED_PARTICIPANTS;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return SEED_PARTICIPANTS;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return SEED_PARTICIPANTS;

      return parsed as Participant[];
    } catch {
      return SEED_PARTICIPANTS;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Participant[] => {
    // Cached so repeated calls return the same reference; returning a fresh
    // array each time would make React treat every render as a change.
    this.cache ??= this.read();
    return this.cache;
  };

  getServerSnapshot = (): Participant[] => SEED_PARTICIPANTS;

  save = (participants: Participant[]): void => {
    this.cache = participants;
    this.emit();

    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(participants));
    } catch {
      // A failed write (quota, private mode) should not interrupt scheduling;
      // the list is still correct in memory for this session.
    }
  };

  reset = (): void => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to recover from; the seed list is restored regardless.
      }
    }

    this.cache = SEED_PARTICIPANTS;
    this.emit();
  };
}

export const participantRepository: ParticipantRepository =
  new LocalStorageParticipantRepository();
