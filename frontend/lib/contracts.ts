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

export const farmContextSchema = z
  .object({
    owner_username: z.string().min(1),
  })
  .strict()

export type FarmContext = z.infer<typeof farmContextSchema>

export const loginResponseSchema = whoamiSchema.extend({
  session_token: z.string().min(1),
})

export type LoginResponse = z.infer<typeof loginResponseSchema>

// Closed enum sets, mirroring backend models/enums.py (exact lowercase values).
export const stateSchema = z.enum([
  'not-started',
  'defining',
  'spec',
  'implement',
  'review',
  'merged',
  'released',
  'done',
  'abandoned',
])

export const ballSchema = z.enum(['you', 'agent', 'person'])

export const statusSchema = z.enum([
  'ready',
  'monitoring',
  'waiting',
  'blocked',
  'done',
  'dropped',
  'rollup',
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
export type Ball = z.infer<typeof ballSchema>
export type ItemStatus = z.infer<typeof statusSchema>
export type Mode = z.infer<typeof modeSchema>
export type Effort = z.infer<typeof effortSchema>

// Mirrors the backend ItemOut Pydantic model (api/schemas.py). Nullable columns
// use .nullable(); timestamps are ISO-8601 UTC strings; sort_order is a number.
export const itemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    parent_id: z.string().nullable(),
    sort_order: z.number(),
    state: stateSchema,
    ball: ballSchema,
    mode: modeSchema,
    effort: effortSchema,
    blocked_note: z.string().nullable(),
    blocked_followup_date: z.string().nullable(),
    dev_updated: z.boolean(),
    prod_updated: z.boolean(),
    docs_updated: z.boolean(),
    announced: z.boolean(),
    description: z.string(),
    repo_url: z.string().nullable(),
    usage: z.string(),
    created_by: z.string(),
    updated_by: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    state_changed_at: z.string(),
    ball_changed_at: z.string(),
    completed_at: z.string().nullable(),
  })
  .strict()

export type Item = z.infer<typeof itemSchema>

export const priorityItemSchema = itemSchema
  .extend({
    rank: z.number().int().positive(),
  })
  .strict()

export const priorityResponseSchema = z.array(priorityItemSchema)

export type PriorityItem = z.infer<typeof priorityItemSchema>

export const homePriorityItemSchema = z
  .object({
    id: z.string(),
    rank: z.number().int().positive(),
  })
  .strict()

export type HomePriorityItem = z.infer<typeof homePriorityItemSchema>

export const treeDependencyEdgeSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    automatic_chain: z.boolean().optional(),
  })
  .strict()

export type TreeDependencyEdge = z.infer<typeof treeDependencyEdgeSchema>

export const rollupStatusCountsSchema = z
  .object({
    ready: z.number().int(),
    monitoring: z.number().int(),
    waiting: z.number().int(),
    blocked: z.number().int(),
    done: z.number().int(),
    dropped: z.number().int(),
  })
  .strict()

export const rollupShipProgressSchema = z
  .object({
    dev_updated: z.number().int(),
    prod_updated: z.number().int(),
    docs_updated: z.number().int(),
    announced: z.number().int(),
    shipped: z.number().int(),
    total: z.number().int(),
  })
  .strict()

export const rollupSchema = z
  .object({
    status_counts: rollupStatusCountsSchema,
    ship: rollupShipProgressSchema,
    phase: stateSchema.nullable(),
  })
  .strict()

export type Rollup = z.infer<typeof rollupSchema>

export const treeItemSchema = itemSchema
  .extend({
    needs: z.array(z.string()),
    needs_edges: z.array(treeDependencyEdgeSchema),
    status: statusSchema,
    resume: z.boolean(),
    rollup: rollupSchema.nullable(),
    actionable: z.boolean(),
    complete: z.boolean(),
    has_notes: z.boolean(),
    has_prompt_response_entries: z.boolean(),
  })
  .strict()

export const treeSchema = z.array(treeItemSchema)

export type TreeItem = z.infer<typeof treeItemSchema>

export const deletedResponseSchema = z.object({
  deleted: z.boolean(),
  id: z.string(),
})

export type DeletedResponse = z.infer<typeof deletedResponseSchema>

export const dependencySchema = z
  .object({
    id: z.string(),
    from_id: z.string(),
    to_id: z.string(),
    kind: z.literal('explicit'),
  })
  .strict()

export type Dependency = z.infer<typeof dependencySchema>

export const runSchema = z
  .object({
    id: z.string(),
    item_id: z.string(),
    status: z.literal('pending'),
    created_at: z.string(),
  })
  .strict()

export const runListSchema = z.array(runSchema)

export type Run = z.infer<typeof runSchema>

export const notImplementedResponseSchema = z
  .object({
    detail: z.string(),
  })
  .strict()

export type NotImplementedResponse = z.infer<
  typeof notImplementedResponseSchema
>

export const commentSchema = z
  .object({
    id: z.string(),
    item_id: z.string(),
    author: z.string(),
    body: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict()

export const commentListSchema = z.array(commentSchema)

export type Comment = z.infer<typeof commentSchema>

export const noteSchema = z
  .object({
    id: z.string(),
    item_id: z.string(),
    created_by: z.string(),
    body: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict()

export const noteListSchema = z.array(noteSchema)

export type Note = z.infer<typeof noteSchema>

export const promptResponseKindSchema = z.enum(['prompt', 'response'])

export type PromptResponseKind = z.infer<typeof promptResponseKindSchema>

export const promptResponseEntrySchema = z
  .object({
    id: z.string(),
    item_id: z.string(),
    kind: promptResponseKindSchema,
    created_by: z.string(),
    body: z.string(),
    created_at: z.string(),
  })
  .strict()

export const promptResponseEntryListSchema = z.array(promptResponseEntrySchema)

export type PromptResponseEntry = z.infer<typeof promptResponseEntrySchema>

export const scratchpadSchema = z
  .object({
    body: z.string(),
    height: z.number().int().min(120).max(640),
    minimized: z.boolean(),
    updated_by: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .strict()

export type Scratchpad = z.infer<typeof scratchpadSchema>

export const stateChangeActivitySchema = z
  .object({
    id: z.string(),
    item_id: z.string(),
    kind: z.literal('state-change'),
    actor: z.string(),
    from_state: stateSchema,
    to_state: stateSchema,
    created_at: z.string(),
  })
  .strict()

export const ballChangeActivitySchema = z
  .object({
    id: z.string(),
    item_id: z.string(),
    kind: z.literal('ball-change'),
    actor: z.string(),
    from_ball: ballSchema,
    to_ball: ballSchema,
    created_at: z.string(),
  })
  .strict()

export const itemActivitySchema = z.discriminatedUnion('kind', [
  stateChangeActivitySchema,
  ballChangeActivitySchema,
])

export const itemActivityListSchema = z.array(itemActivitySchema)

export type ItemActivity = z.infer<typeof itemActivitySchema>

export const markerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    at: z.string(),
    created_at: z.string(),
  })
  .strict()

export const markerListSchema = z.array(markerSchema)

export type Marker = z.infer<typeof markerSchema>

export const homePayloadSchema = z
  .object({
    owner_username: z.string().min(1),
    session: whoamiSchema,
    items: treeSchema,
    priority_items: z.array(homePriorityItemSchema),
    markers: markerListSchema,
    scratchpad: scratchpadSchema,
  })
  .strict()

export type HomePayload = z.infer<typeof homePayloadSchema>

export const markerChangeFieldSchema = z.enum([
  'created',
  'changed',
  'completed',
])

export type MarkerChangeField = z.infer<typeof markerChangeFieldSchema>

export const markerChangeItemsSchema = z.array(itemSchema)
