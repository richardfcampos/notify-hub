/**
 * Request body SHAPE schema + validator for POST /notify (spec NOTIF-01.3).
 * This only validates the body's structure/types. Whether each `channels`
 * entry is a KNOWN instance id is no longer static -- instances live in the
 * DB now, so that check moved to the route (a repository lookup that 400s an
 * unknown id, naming it). Kept as a factory for call-site symmetry, but it
 * takes no arguments.
 */
import { z } from 'zod'

const priorityValues = ['low', 'default', 'high', 'urgent'] as const

/** Builds the zod schema for the notify body (structure/types only). */
export function buildNotifySchema() {
  return z.object({
    title: z.string().optional(),
    // Trimmed then length-checked, so whitespace-only messages are rejected.
    message: z.string().trim().min(1, 'message must not be empty'),
    priority: z.enum(priorityValues).optional(),
    tags: z.array(z.string()).optional(),
    channels: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional()
  })
}

export type NotifySchema = ReturnType<typeof buildNotifySchema>
export type NotifyBody = z.infer<NotifySchema>
