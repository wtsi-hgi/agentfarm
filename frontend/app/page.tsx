import { AppShell } from '@/components/app-shell'
import { LoginForm } from '@/components/login-form'
import { Outliner } from '@/components/outliner'
import type {
  HomePriorityItem,
  Marker,
  Scratchpad,
  TreeItem,
} from '@/lib/contracts'
import { DEFAULT_SCRATCHPAD } from '@/lib/scratchpad'
import { readSessionIdentity, type SessionIdentity } from '@/lib/session'

import { fetchFarmContext, fetchHomePayload } from './actions'

type HomeProtectedData = {
  items: TreeItem[]
  markers: Marker[]
  ownerUsername: string | null
  priorityItems: HomePriorityItem[]
  scratchpad: Scratchpad
  session: SessionIdentity | null
  authorized: boolean
}

function isUnauthorizedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false
  }

  return (error as { status: unknown }).status === 401
}

function countLeafItems(items: readonly TreeItem[]): number {
  const sectionItemIds = new Set(
    items
      .map((item) => item.parent_id)
      .filter((parentId): parentId is string => parentId !== null)
  )
  return items.filter((item) => !sectionItemIds.has(item.id)).length
}

function signedOutHomeData(): HomeProtectedData {
  return {
    authorized: false,
    items: [],
    markers: [],
    ownerUsername: null,
    priorityItems: [],
    scratchpad: DEFAULT_SCRATCHPAD,
    session: null,
  }
}

async function fetchProtectedHomeData(
  sessionToken: string
): Promise<HomeProtectedData> {
  try {
    const payload = await fetchHomePayload()
    return {
      authorized: true,
      items: payload.items,
      markers: payload.markers,
      ownerUsername: payload.owner_username,
      priorityItems: payload.priority_items,
      scratchpad: payload.scratchpad,
      session: {
        ...payload.session,
        session_token: sessionToken,
      },
    }
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error
    }

    return signedOutHomeData()
  }
}

export default async function Home() {
  const storedSession = await readSessionIdentity()
  const protectedData = storedSession
    ? await fetchProtectedHomeData(storedSession.session_token)
    : signedOutHomeData()
  const ownerUsername =
    protectedData.ownerUsername ?? (await fetchFarmContext()).owner_username
  const { authorized, items, markers, priorityItems, scratchpad, session } =
    protectedData
  const leafItemCount = countLeafItems(items)

  const metrics = authorized ? (
    <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
      <div>
        <dt className="text-xs uppercase">Items</dt>
        <dd className="text-foreground font-medium">{leafItemCount}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase">Priority</dt>
        <dd className="text-foreground font-medium">{priorityItems.length}</dd>
      </div>
    </dl>
  ) : null

  return (
    <AppShell
      ownerUsername={ownerUsername}
      session={authorized ? session : null}
      metrics={metrics}
    >
      {authorized ? (
        <Outliner
          items={items}
          leverageSort={priorityItems.length > 0}
          markers={markers}
          priorityItems={priorityItems}
          scratchpad={scratchpad}
          scratchpadEditable={session?.role === 'owner'}
        />
      ) : (
        <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center py-8">
          <LoginForm nextPath="/" />
        </div>
      )}
    </AppShell>
  )
}
