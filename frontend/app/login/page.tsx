import { LoginForm } from '@/components/login-form'

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[]
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {}
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-8">
      <LoginForm nextPath={nextParam} />
    </main>
  )
}
