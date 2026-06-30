import { AuthUtility } from '@/components/auth-utility'
import { type SessionIdentity } from '@/lib/session'

type AppShellProps = {
  children: React.ReactNode
  ownerUsername: string
  session: SessionIdentity | null
  metrics?: React.ReactNode
}

export function AppShell({
  children,
  ownerUsername,
  session,
  metrics,
}: AppShellProps) {
  return (
    <main className="bg-background min-h-screen">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-border flex flex-col gap-4 border-b pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-foreground text-2xl font-semibold tracking-tight">
                {ownerUsername}&apos;s Agent Farm
              </h1>
            </div>
            <AuthUtility session={session} />
          </div>
          {metrics ? (
            <div className="flex justify-start sm:justify-end">{metrics}</div>
          ) : null}
        </header>
        {children}
      </section>
    </main>
  )
}
