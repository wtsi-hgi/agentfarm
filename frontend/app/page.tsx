import { AppShell } from '@/components/app-shell'
import { LoginForm } from '@/components/login-form'
import { Outliner } from '@/components/outliner'
import type {
  Marker,
  PriorityItem,
  Scratchpad,
  TreeItem,
} from '@/lib/contracts'
import { DEFAULT_SCRATCHPAD } from '@/lib/scratchpad'

import {
  fetchFarmContext,
  fetchMarkers,
  fetchPriority,
  fetchScratchpad,
  fetchSessionIdentity,
  fetchTree,
} from './actions'

type HomeProtectedData = {
  items: TreeItem[]
  markers: Marker[]
  priorityItems: PriorityItem[]
  scratchpad: Scratchpad
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

async function fetchProtectedHomeData(): Promise<HomeProtectedData> {
  try {
    const [items, priorityItems, markers, scratchpad] = await Promise.all([
      fetchTree(),
      fetchPriority(),
      fetchMarkers(),
      fetchScratchpad(),
    ])
    return { authorized: true, items, markers, priorityItems, scratchpad }
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error
    }

    return {
      authorized: false,
      items: [],
      markers: [],
      priorityItems: [],
      scratchpad: DEFAULT_SCRATCHPAD,
    }
  }
}

export default async function Home() {
  const [farmContext, session] = await Promise.all([
    fetchFarmContext(),
    fetchSessionIdentity(),
  ])
  const { authorized, items, markers, priorityItems, scratchpad } = session
    ? await fetchProtectedHomeData()
    : {
        authorized: false,
        items: [],
        markers: [],
        priorityItems: [],
        scratchpad: DEFAULT_SCRATCHPAD,
      }
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
      ownerUsername={farmContext.owner_username}
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
