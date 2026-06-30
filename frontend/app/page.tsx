import { AppShell } from '@/components/app-shell'
import { Outliner } from '@/components/outliner'

import {
  fetchFarmContext,
  fetchPriority,
  fetchSessionIdentity,
  fetchTree,
} from './actions'

export default async function Home() {
  const [items, priorityItems, farmContext, session] = await Promise.all([
    fetchTree(),
    fetchPriority(),
    fetchFarmContext(),
    fetchSessionIdentity(),
  ])

  return (
    <AppShell
      ownerUsername={farmContext.owner_username}
      session={session}
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
        priorityItems={priorityItems}
      />
    </AppShell>
  )
}
