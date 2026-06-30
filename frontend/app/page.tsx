import { Outliner } from '@/components/outliner'

import { fetchPriority, fetchTree } from './actions'

export default async function Home() {
  const [items, priorityItems] = await Promise.all([
    fetchTree(),
    fetchPriority(),
  ])

  return (
    <main className="bg-background min-h-screen">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-border flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">
              Agent Farm
            </h1>
          </div>
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
        </header>
        <Outliner
          items={items}
          leverageSort={priorityItems.length > 0}
          priorityItems={priorityItems}
        />
      </section>
    </main>
  )
}
