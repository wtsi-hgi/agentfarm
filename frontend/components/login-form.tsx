'use client'

import { useActionState, useEffect } from 'react'

import { login, type LoginState } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const initialLoginState: LoginState = {
  status: 'idle',
  error: null,
}

export function normalizeNextPath(nextPath: string | undefined): string {
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) {
    return '/'
  }
  return nextPath
}

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction, pending] = useActionState(login, initialLoginState)
  const safeNextPath = normalizeNextPath(nextPath)

  useEffect(() => {
    if (state.status === 'success') {
      window.location.assign(safeNextPath)
    }
  }, [safeNextPath, state.status])

  return (
    <Card className="w-full max-w-sm rounded-lg shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="username">
              Username
            </label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={pending}
              required
            />
          </div>
          {state.status === 'error' && state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
