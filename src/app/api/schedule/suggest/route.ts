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
    // SchedulingError covers input the schema cannot express on its own, such as
    // an end date preceding the start. Anything else is a genuine fault.
    if (error instanceof SchedulingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Failed to compute suggestions", error);
    return NextResponse.json({ error: "Failed to compute suggestions" }, { status: 500 });
  }
}
