/**
 * POST /api/schedule/suggest
 *
 * The route is deliberately thin: parse, validate, delegate, serialise. All the
 * scheduling logic lives in `@/lib/scheduling`, which knows nothing about HTTP.
 * Everything a client needs - including each participant's local times - is
 * resolved server-side, so the UI never repeats the time-zone maths and the two
 * cannot drift apart.
 */

import { NextResponse } from "next/server";
import { formatIssues, suggestRequestSchema } from "@/lib/api/schema";
import { SchedulingError, suggest } from "@/lib/scheduling/suggest";
import type { Participant } from "@/lib/scheduling/types";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = suggestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", fields: formatIssues(parsed.error) },
      { status: 400 },
    );
  }

  try {
    // Zod has already guaranteed the shape; the cast reconciles its inferred
    // weekday number with the domain's narrower Weekday union.
    const result = suggest({
      ...parsed.data,
      participants: parsed.data.participants as Participant[],
    });
    return NextResponse.json(result);
  } catch (error) {
    // SchedulingError means the caller sent something invalid that the schema
    // could not catch on its own - an end date before the start, say. Their
    // problem, and the message is safe to hand back.
    if (error instanceof SchedulingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Anything else is our bug. The detail goes to the logs; the caller gets a
    // generic message, because internal errors can leak stack traces and paths.
    console.error("Failed to compute suggestions", error);
    return NextResponse.json({ error: "Failed to compute suggestions" }, { status: 500 });
  }
}
