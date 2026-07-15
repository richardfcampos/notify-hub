/**
 * Request body schema + validator for POST /notify (spec NOTIF-01.3 +
 * edge case "unknown channel -> 400"). `buildNotifySchema` is a factory
 * because the set of acceptable `channels` names is not static -- it is the
 * set of channels actually active in this deployment, so an unknown channel
 * is rejected at the boundary (400) instead of being enqueued and silently
 * dropped later.
 */
import { z } from 'zod'

const priorityValues = ['low', 'default', 'high', 'urgent'] as const

/**
 * Builds the zod schema for the notify body. `activeChannelNames` is the set
 * of channels that may appear in `channels`; any other entry makes the body
 * invalid, with an error message that names the offending channel.
 */
export function buildNotifySchema(activeChannelNames: string[]) {
  const active = new Set(activeChannelNames)

  return z
    .object({
      title: z.string().optional(),
      // Trimmed then length-checked, so whitespace-only messages are rejected.
      message: z.string().trim().min(1, 'message must not be empty'),
      priority: z.enum(priorityValues).optional(),
      tags: z.array(z.string()).optional(),
      channels: z.array(z.string()).optional(),
      metadata: z.record(z.unknown()).optional()
    })
    .superRefine((body, ctx) => {
      if (!body.channels) {
        return
      }
      for (const channel of body.channels) {
        if (!active.has(channel)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['channels'],
            message: `unknown channel "${channel}"`
          })
        }
      }
    })
}

export type NotifySchema = ReturnType<typeof buildNotifySchema>
export type NotifyBody = z.infer<NotifySchema>
