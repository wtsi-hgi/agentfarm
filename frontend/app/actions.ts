'use server'

import { backendJson } from '@/lib/backend-client'
import {
  healthResponseSchema,
  messageResponseSchema,
  whoamiSchema,
} from '@/lib/contracts'
import { type GreetingState } from '@/lib/greeting-state'
import { setSessionCookie } from '@/lib/session'

export type LoginState = {
  status: 'idle' | 'success' | 'error'
  error: string | null
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
