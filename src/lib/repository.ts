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
 */

import type { Participant } from "./scheduling/types";
import { SEED_PARTICIPANTS } from "./seed";

export interface ParticipantRepository {
  load(): Participant[];
  save(participants: Participant[]): void;
  reset(): Participant[];
}

const STORAGE_KEY = "meeting-scheduler.participants.v1";

/**
 * Browser-backed storage, falling back to the seed team.
 *
 * Every read is defensive: `localStorage` is unavailable during server rendering
 * and in private-browsing modes, and its contents are user-editable and may be
 * from an older version of the app. A corrupt entry should drop the app back to a
 * working default rather than leaving a blank screen.
 */
export class LocalStorageParticipantRepository implements ParticipantRepository {
  load(): Participant[] {
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

  save(participants: Participant[]): void {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(participants));
    } catch {
      // A failed write (quota, private mode) should not interrupt scheduling -
      // the participant list is still correct in memory for this session.
    }
  }

  reset(): Participant[] {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to recover from; the seed list is returned regardless.
      }
    }
    return SEED_PARTICIPANTS;
  }
}

export const participantRepository: ParticipantRepository =
  new LocalStorageParticipantRepository();
