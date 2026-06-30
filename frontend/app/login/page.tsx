import { AppShell } from '@/components/app-shell'
import { LoginForm } from '@/components/login-form'

import { fetchFarmContext, fetchSessionIdentity } from '../actions'

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[]
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {}
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next
  const [farmContext, session] = await Promise.all([
    fetchFarmContext(),
    fetchSessionIdentity(),
  ])

  return (
    <AppShell ownerUsername={farmContext.owner_username} session={session}>
      <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center py-8">
        <LoginForm nextPath={nextParam} />
      </div>
    </AppShell>
  )
}
