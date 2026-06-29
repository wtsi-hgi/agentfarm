export const SESSION_COOKIE_NAME = 'agentfarm_session'

export type SessionIdentity = {
  username: string
  role: 'owner' | 'viewer'
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const

export function encodeSessionIdentity(identity: SessionIdentity): string {
  return encodeURIComponent(JSON.stringify(identity))
}

export function parseSessionIdentity(
  value: string | undefined
): SessionIdentity | null {
  if (!value) {
    return null
  }

  try {
    const decoded = decodeURIComponent(value)
    const parsed = JSON.parse(decoded) as Partial<SessionIdentity>
    if (
      typeof parsed.username === 'string' &&
      parsed.username.length > 0 &&
      (parsed.role === 'owner' || parsed.role === 'viewer')
    ) {
      return { username: parsed.username, role: parsed.role }
    }
  } catch {
    return null
  }

  return null
}

export async function setSessionCookie(
  identity: SessionIdentity
): Promise<void> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE_NAME,
    encodeSessionIdentity(identity),
    SESSION_COOKIE_OPTIONS
  )
}

export async function readSessionIdentity(): Promise<SessionIdentity | null> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  return parseSessionIdentity(cookieStore.get(SESSION_COOKIE_NAME)?.value)
}
