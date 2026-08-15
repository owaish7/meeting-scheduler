/**
 * Request validation for the API routes.
 *
 * The domain layer assumes well-formed input - participants have real IANA zones,
 * times parse, durations are positive. That assumption only holds if something
 * enforces it at the boundary, which is this file's job. Validating here means the
 * scheduling code never has to defend itself against malformed data, and callers
 * get a specific message instead of a stack trace.
 */

import { z } from "zod";
import { isValidTimeZone } from "../scheduling/availability";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeOfDay = z
  .string()
  .regex(TIME_OF_DAY, "Expected a time in HH:mm format, such as 09:00");

const weekday = z
  .number()
  .int()
  .min(1, "Weekday must be between 1 (Monday) and 7 (Sunday)")
  .max(7, "Weekday must be between 1 (Monday) and 7 (Sunday)");

/**
 * Zone identifiers are checked against the actual IANA database rather than a
 * pattern. "Asia/Bangalore" looks perfectly well-formed but does not exist, and
 * would otherwise fail much later with a far less obvious message.
 */
const timeZone = z
  .string()
  .min(1, "Time zone is required")
  .refine(isValidTimeZone, {
    error: (issue) => `Unknown time zone "${String(issue.input)}"`,
  });

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected an ISO 8601 date-time");

export const workingHoursSchema = z
  .object({
    start: timeOfDay,
    end: timeOfDay,
    days: z.array(weekday).min(1, "At least one working day is required"),
  })
  .refine((hours) => hours.start !== hours.end, {
    message: "Start and end times cannot be identical",
    path: ["end"],
  });

export const busyBlockSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1, "A title is required").max(120),
    startUtc: isoDateTime,
    endUtc: isoDateTime,
  })
  .refine((block) => Date.parse(block.endUtc) > Date.parse(block.startUtc), {
    message: "A meeting must end after it starts",
    path: ["endUtc"],
  });

export const participantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "A name is required").max(80),
  location: z.string().max(120).default(""),
  timeZone,
  workingHours: workingHoursSchema,
  busy: z.array(busyBlockSchema).default([]),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");

export const suggestRequestSchema = z.object({
  participants: z
    .array(participantSchema)
    .min(1, "At least one participant is required")
    .max(50, "Too many participants"),
  durationMinutes: z
    .number()
    .int()
    .min(5, "Meetings must be at least 5 minutes")
    .max(24 * 60, "Meetings cannot exceed 24 hours"),
  from: isoDate,
  to: isoDate,
  // 15 minutes matches how meetings are booked in practice; finer granularity
  // multiplies results without making any of them more useful.
  granularityMinutes: z.number().int().min(5).max(120).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
});

export type SuggestRequestInput = z.infer<typeof suggestRequestSchema>;

/** Flatten Zod issues into a field-keyed map the UI can render inline. */
export function formatIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "request";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
