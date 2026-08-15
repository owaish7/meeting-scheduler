/**
 * GET  /api/participants  - the starting team from the brief
 * POST /api/participants  - validate a participant before the client stores it
 *
 * Participants are owned by the client and persisted in the browser (see
 * `ParticipantRepository`), so these routes are not a database. GET supplies the
 * seed team; POST exists so validation rules live in exactly one place and the
 * client cannot quietly diverge from what the scheduler will accept.
 *
 * The reasoning behind not persisting server-side is recorded in PLAN.md: on
 * serverless infrastructure, in-process state is unreliable across invocations,
 * and standing up a real database was not the best use of a fixed time budget
 * when the scheduling logic is the substance. The repository interface marks the
 * seam where a database would attach.
 */

import { NextResponse } from "next/server";
import { formatIssues, participantSchema } from "@/lib/api/schema";
import { SEED_PARTICIPANTS } from "@/lib/seed";

export async function GET() {
  return NextResponse.json({ participants: SEED_PARTICIPANTS });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = participantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid participant", fields: formatIssues(parsed.error) },
      { status: 400 },
    );
  }

  return NextResponse.json({ participant: parsed.data }, { status: 201 });
}
