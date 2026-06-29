'use server'

import { revalidatePath } from 'next/cache'
import { type ZodSchema } from 'zod'

import { backendJson } from '@/lib/backend-client'
import {
  commentListSchema,
  commentSchema,
  deletedResponseSchema,
  dependencySchema,
  healthResponseSchema,
  itemSchema,
  markerChangeItemsSchema,
  markerListSchema,
  markerSchema,
  messageResponseSchema,
  priorityResponseSchema,
  treeSchema,
  whoamiSchema,
  type Effort,
  type MarkerChangeField,
  type Mode,
  type State,
} from '@/lib/contracts'
import { type GreetingState } from '@/lib/greeting-state'
import { setSessionCookie } from '@/lib/session'

export type LoginState = {
  status: 'idle' | 'success' | 'error'
  error: string | null
}

export type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
  mode?: Mode
  effort?: Effort
  state?: State
}

export type PatchItemInput = {
  title?: string
  state?: State
  mode?: Mode
  effort?: Effort
  blocked_external?: boolean
  blocked_note?: string | null
  blocked_followup_date?: string | null
}

export type MoveItemInput = {
  new_parent_id?: string | null
  after_id?: string | null
}

export type DependencyInput =
  | {
      from_id: string
      to_id: string
      needs_slug?: never
    }
  | {
      from_id: string
      needs_slug: string
      to_id?: never
    }

export type CommentInput = {
  body: string
}

export type MarkerInput = {
  name: string
  at?: string | null
}

export type ChangesInput = {
  field?: MarkerChangeField
  since?: string | null
  between?: readonly [string, string] | string | null
}

const PRIMARY_PATH = '/'

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function mutation<T>(
  path: string,
  schema: ZodSchema<T>,
  init: RequestInit
): Promise<T> {
  const result = await backendJson(path, schema, init)
  revalidatePath(PRIMARY_PATH)
  return result
}

export async function requestGreeting(
  _prevState: GreetingState,
  formData: FormData
): Promise<GreetingState> {
  const name = (formData.get('name') ?? 'World').toString() || 'World'

  try {
    const response = await backendJson(
      `/api/v1/hello?name=${encodeURIComponent(name)}`,
      messageResponseSchema
    )
    return {
      status: 'success',
      message: response.message,
      error: null,
    }
  } catch (error) {
    return {
      status: 'error',
      message: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function fetchInitialGreeting() {
  return backendJson('/api/v1/hello', messageResponseSchema)
}

export async function fetchHealth() {
  return backendJson('/api/v1/health', healthResponseSchema)
}

export async function fetchTree() {
  return backendJson('/api/v1/tree', treeSchema)
}

export async function fetchPriority() {
  return backendJson('/api/v1/priority', priorityResponseSchema)
}

export async function createItem(input: CreateItemInput) {
  return mutation('/api/v1/items', itemSchema, jsonInit('POST', input))
}

export async function patchItem(itemId: string, input: PatchItemInput) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}`,
    itemSchema,
    jsonInit('PATCH', input)
  )
}

export async function deleteItem(itemId: string) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}`,
    deletedResponseSchema,
    jsonInit('DELETE')
  )
}

export async function indentItem(itemId: string) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/indent`,
    itemSchema,
    jsonInit('POST')
  )
}

export async function outdentItem(itemId: string) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/outdent`,
    itemSchema,
    jsonInit('POST')
  )
}

export async function moveItem(itemId: string, input: MoveItemInput) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/move`,
    itemSchema,
    jsonInit('POST', input)
  )
}

export async function addDependency(input: DependencyInput) {
  return mutation(
    '/api/v1/dependencies',
    dependencySchema,
    jsonInit('POST', input)
  )
}

export async function deleteDependency(dependencyId: string) {
  return mutation(
    `/api/v1/dependencies/${encodeURIComponent(dependencyId)}`,
    deletedResponseSchema,
    jsonInit('DELETE')
  )
}

export async function fetchComments(itemId: string) {
  return backendJson(
    `/api/v1/items/${encodeURIComponent(itemId)}/comments`,
    commentListSchema
  )
}

export async function createComment(itemId: string, input: CommentInput) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/comments`,
    commentSchema,
    jsonInit('POST', input)
  )
}

export async function editComment(commentId: string, input: CommentInput) {
  return mutation(
    `/api/v1/comments/${encodeURIComponent(commentId)}`,
    commentSchema,
    jsonInit('PATCH', input)
  )
}

export async function deleteComment(commentId: string) {
  return mutation(
    `/api/v1/comments/${encodeURIComponent(commentId)}`,
    deletedResponseSchema,
    jsonInit('DELETE')
  )
}

export async function fetchMarkers() {
  return backendJson('/api/v1/markers', markerListSchema)
}

export async function createMarker(input: MarkerInput) {
  return mutation('/api/v1/markers', markerSchema, jsonInit('POST', input))
}

export async function fetchChanges(input: ChangesInput) {
  const params = new URLSearchParams()
  params.set('field', input.field ?? 'changed')

  const between = input.between
  if (between) {
    params.set(
      'between',
      typeof between === 'string' ? between : between.join(',')
    )
  } else if (input.since) {
    params.set('since', input.since)
  }

  return backendJson(
    `/api/v1/changes?${params.toString()}`,
    markerChangeItemsSchema
  )
}

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = (formData.get('username') ?? '').toString()
  const password = (formData.get('password') ?? '').toString()

  try {
    const identity = await backendJson('/api/v1/auth/login', whoamiSchema, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    await setSessionCookie(identity)
    return { status: 'success', error: null }
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Login failed',
    }
  }
}
