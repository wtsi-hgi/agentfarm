import { AppShell } from '@/components/app-shell'
import { Outliner } from '@/components/outliner'
import type { Marker, PriorityItem, TreeItem } from '@/lib/contracts'

import {
  fetchFarmContext,
  fetchMarkers,
  fetchPriority,
  fetchSessionIdentity,
  fetchTree,
} from './actions'

type HomeProtectedData = {
  items: TreeItem[]
  markers: Marker[]
  priorityItems: PriorityItem[]
  authorized: boolean
}

function isUnauthorizedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false
  }

  return (error as { status: unknown }).status === 401
}

async function fetchProtectedHomeData(): Promise<HomeProtectedData> {
  try {
    const [items, priorityItems, markers] = await Promise.all([
      fetchTree(),
      fetchPriority(),
      fetchMarkers(),
    ])
    return { authorized: true, items, markers, priorityItems }
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error
    }

    return { authorized: false, items: [], markers: [], priorityItems: [] }
  }
}

export default async function Home() {
  const [farmContext, session] = await Promise.all([
    fetchFarmContext(),
    fetchSessionIdentity(),
  ])
  const { authorized, items, markers, priorityItems } = session
    ? await fetchProtectedHomeData()
    : { authorized: false, items: [], markers: [], priorityItems: [] }

  return (
    <AppShell
      ownerUsername={farmContext.owner_username}
      session={authorized ? session : null}
      metrics={
        <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
          <div>
            <dt className="text-xs uppercase">Items</dt>
            <dd className="text-foreground font-medium">{items.length}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase">Priority</dt>
            <dd className="text-foreground font-medium">
              {priorityItems.length}
            </dd>
          </div>
        </dl>
      }
    >
      <Outliner
        items={items}
        leverageSort={priorityItems.length > 0}
        markers={markers}
        priorityItems={priorityItems}
      />
    </AppShell>
  )
}
