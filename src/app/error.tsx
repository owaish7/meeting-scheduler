"use client";

/**
 * Last line of defence for a render that throws.
 *
 * Without this, an unexpected error in any component takes the whole page down
 * to a blank screen with nothing to act on. A coordinator mid-way through
 * scheduling gets an explanation and a way back instead, and their participant
 * list survives - it lives in browser storage, not in the component tree that
 * just failed.
 */

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the platform logs; in a longer-lived service this is where an
    // error reporter would be wired in.
    console.error("Unhandled error", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-4 py-20">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          The page failed to render. Your participants are saved in this browser, so nothing has
          been lost — trying again will usually recover.
        </p>

        {/* The digest identifies this occurrence in the server logs; the message
            itself is not shown, since it can carry internal detail. */}
        {error.digest && (
          <p className="tabular mt-3 text-xs text-[var(--muted)]">Reference: {error.digest}</p>
        )}

        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
