'use server'

import { revalidatePath } from 'next/cache'
import { type ZodSchema } from 'zod'

import { backendJson } from '@/lib/backend-client'
import {
  commentListSchema,
  commentSchema,
  deletedResponseSchema,
  dependencySchema,
  farmContextSchema,
  healthResponseSchema,
  homePayloadSchema,
  itemActivityListSchema,
  itemSchema,
  loginResponseSchema,
  markerChangeItemsSchema,
  markerListSchema,
  markerSchema,
  messageResponseSchema,
  noteListSchema,
  noteSchema,
  notImplementedResponseSchema,
  priorityResponseSchema,
  promptResponseEntryListSchema,
  promptResponseEntrySchema,
  runListSchema,
  runSchema,
  scratchpadSchema,
  treeSchema,
  type Effort,
  type MarkerChangeField,
  type Mode,
  type PromptResponseKind,
  type State,
  whoamiSchema,
} from '@/lib/contracts'
import { type GreetingState } from '@/lib/greeting-state'
import {
  clearSessionCookie,
  readSessionIdentity,
  setSessionCookie,
} from '@/lib/session'

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
  description?: string | null
  repo_url?: string | null
  usage?: string | null
}

export type MoveItemInput =
  | {
      new_parent_id?: string | null
      position: 'first'
      after_id?: never
    }
  | {
      new_parent_id?: string | null
      position?: 'after'
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

export type NoteInput = {
  body: string
}

export type PromptResponseEntryInput = {
  kind: PromptResponseKind
  body: string
}

export type ScratchpadInput = {
  body?: string
  height?: number
  minimized?: boolean
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

type MutationOptions = {
  revalidate?: boolean
}

const PRIMARY_PATH = '/'

function statusFromError(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null
  }

  const status = (error as { status: unknown }).status
  return typeof status === 'number' ? status : null
}

function loginErrorMessage(error: unknown): string {
  switch (statusFromError(error)) {
    case 401:
      return 'Invalid username or password'
    case 403:
      return 'Your account is not allowed to use Agent Farm'
    default:
      return error instanceof Error ? error.message : 'Login failed'
  }
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function authenticatedInit(init: RequestInit): Promise<RequestInit> {
  const identity = await readSessionIdentity()
  if (!identity) {
    return init
  }

  const headers = new Headers(init.headers)
  headers.set('x-agentfarm-session', identity.session_token)
  return {
    ...init,
    headers,
  }
}

async function mutation<T>(
  path: string,
  schema: ZodSchema<T>,
  init: RequestInit,
  options: MutationOptions = {}
): Promise<T> {
  const result = await backendJson(path, schema, await authenticatedInit(init))
  if (options.revalidate ?? true) {
    revalidatePath(PRIMARY_PATH)
  }
  return result
}

async function authenticatedRead<T>(
  path: string,
  schema: ZodSchema<T>
): Promise<T> {
  return backendJson(path, schema, await authenticatedInit({}))
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

export async function fetchFarmContext() {
  return backendJson('/api/v1/auth/context', farmContextSchema)
}

export async function fetchSessionIdentity() {
  const identity = await readSessionIdentity()
  if (!identity) {
    return null
  }

  try {
    const verified = await backendJson('/api/v1/auth/whoami', whoamiSchema, {
      headers: {
        'x-agentfarm-session': identity.session_token,
      },
    })
    return {
      ...verified,
      session_token: identity.session_token,
    }
  } catch {
    return null
  }
}

export async function fetchTree() {
  return authenticatedRead('/api/v1/tree', treeSchema)
}

export async function fetchPriority() {
  return authenticatedRead('/api/v1/priority', priorityResponseSchema)
}

export async function fetchHomePayload() {
  return authenticatedRead('/api/v1/home', homePayloadSchema)
}

export async function createItem(input: CreateItemInput) {
  return mutation('/api/v1/items', itemSchema, jsonInit('POST', input), {
    revalidate: false,
  })
}

export async function patchItem(itemId: string, input: PatchItemInput) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}`,
    itemSchema,
    jsonInit('PATCH', input),
    { revalidate: false }
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

export async function createRun(itemId: string) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/runs`,
    runSchema,
    jsonInit('POST')
  )
}

export async function listRuns(itemId: string) {
  return authenticatedRead(
    `/api/v1/items/${encodeURIComponent(itemId)}/runs`,
    runListSchema
  )
}

export async function spawnItem(itemId: string) {
  return backendJson(
    `/api/v1/items/${encodeURIComponent(itemId)}/spawn`,
    notImplementedResponseSchema,
    await authenticatedInit(jsonInit('POST')),
    { expectedStatuses: [501] }
  )
}

export async function fetchComments(itemId: string) {
  return authenticatedRead(
    `/api/v1/items/${encodeURIComponent(itemId)}/comments`,
    commentListSchema
  )
}

export async function fetchItemActivity(itemId: string) {
  return authenticatedRead(
    `/api/v1/items/${encodeURIComponent(itemId)}/activity`,
    itemActivityListSchema
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

export async function fetchNotes(itemId: string) {
  return authenticatedRead(
    `/api/v1/items/${encodeURIComponent(itemId)}/notes`,
    noteListSchema
  )
}

export async function createNote(itemId: string, input: NoteInput) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/notes`,
    noteSchema,
    jsonInit('POST', input)
  )
}

export async function editNote(noteId: string, input: NoteInput) {
  return mutation(
    `/api/v1/notes/${encodeURIComponent(noteId)}`,
    noteSchema,
    jsonInit('PATCH', input)
  )
}

export async function fetchPromptResponseEntries(itemId: string) {
  return authenticatedRead(
    `/api/v1/items/${encodeURIComponent(itemId)}/prompt-responses`,
    promptResponseEntryListSchema
  )
}

export async function createPromptResponseEntry(
  itemId: string,
  input: PromptResponseEntryInput
) {
  return mutation(
    `/api/v1/items/${encodeURIComponent(itemId)}/prompt-responses`,
    promptResponseEntrySchema,
    jsonInit('POST', input)
  )
}

export async function fetchScratchpad() {
  return authenticatedRead('/api/v1/scratchpad', scratchpadSchema)
}

export async function updateScratchpad(input: ScratchpadInput) {
  return mutation(
    '/api/v1/scratchpad',
    scratchpadSchema,
    jsonInit('PATCH', input),
    { revalidate: false }
  )
}

export async function fetchMarkers() {
  return authenticatedRead('/api/v1/markers', markerListSchema)
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

  return authenticatedRead(
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
    const identity = await backendJson(
      '/api/v1/auth/login',
      loginResponseSchema,
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }
    )
    await setSessionCookie(identity)
    return { status: 'success', error: null }
  } catch (error) {
    return {
      status: 'error',
      error: loginErrorMessage(error),
    }
  }
}

export async function logout(): Promise<void> {
  await clearSessionCookie()
  revalidatePath(PRIMARY_PATH)
}
