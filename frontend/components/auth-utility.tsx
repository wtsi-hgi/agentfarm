import { LogOut, UserRound } from 'lucide-react'

import { logout } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { type SessionIdentity } from '@/lib/session'

function roleLabel(role: SessionIdentity['role']): string {
  return role === 'owner' ? 'Primary user' : 'Manager'
}

export function AuthUtility({ session }: { session: SessionIdentity | null }) {
  if (!session) {
    return (
      <nav
        aria-label="Account"
        className="border-border bg-card text-card-foreground flex items-center gap-3 rounded-lg border px-3 py-2"
      >
        <UserRound className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Not signed in</p>
          <p className="text-muted-foreground text-xs">Login required</p>
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label="Account"
      className="border-border bg-card text-card-foreground flex items-center gap-3 rounded-lg border px-3 py-2"
    >
      <UserRound className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{session.username}</p>
        <p className="text-muted-foreground text-xs">
          {roleLabel(session.role)}
        </p>
      </div>
      <form action={logout}>
        <Button type="submit" variant="outline" size="sm">
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </nav>
  )
}
