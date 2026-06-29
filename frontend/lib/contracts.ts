import { z } from 'zod'

export const messageResponseSchema = z.object({
  message: z.string().min(1),
})

export type MessageResponse = z.infer<typeof messageResponseSchema>

export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']).or(z.string()),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const errorResponseSchema = z.object({
  message: z.string().optional(),
  detail: z.unknown().optional(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

export const whoamiSchema = z.object({
  username: z.string().min(1),
  role: z.enum(['owner', 'viewer']),
})

export type WhoAmI = z.infer<typeof whoamiSchema>

// Closed enum sets, mirroring backend models/enums.py (exact lowercase values).
export const stateSchema = z.enum([
  'not-started',
  'spec',
  'implement',
  'review',
  'merged',
  'released',
  'done',
  'abandoned',
])

export const modeSchema = z.enum([
  'prompt-agent',
  'review',
  'merge',
  'release',
  'spec',
])

export const effortSchema = z.enum(['quick', 'medium', 'long'])

export type State = z.infer<typeof stateSchema>
export type Mode = z.infer<typeof modeSchema>
export type Effort = z.infer<typeof effortSchema>

// Mirrors the backend ItemOut Pydantic model (api/schemas.py). Nullable columns
// use .nullable(); timestamps are ISO-8601 UTC strings; sort_order is a number.
export const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  parent_id: z.string().nullable(),
  sort_order: z.number(),
  state: stateSchema,
  mode: modeSchema,
  effort: effortSchema,
  blocked_external: z.boolean(),
  blocked_note: z.string().nullable(),
  blocked_followup_date: z.string().nullable(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  state_changed_at: z.string(),
  completed_at: z.string().nullable(),
})

export type Item = z.infer<typeof itemSchema>

export const priorityItemSchema = itemSchema
  .extend({
    rank: z.number().int().positive(),
  })
  .strict()

export const priorityResponseSchema = z.array(priorityItemSchema)

export type PriorityItem = z.infer<typeof priorityItemSchema>
