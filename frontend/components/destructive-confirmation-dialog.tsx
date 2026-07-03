'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type DestructiveConfirmationDialogProps = {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel?: string
  confirmingLabel?: string
  cancelLabel?: string
  onCancel: () => void
  onConfirm: () => Promise<void> | void
  className?: string
}

const FOCUSABLE_SELECTOR = [
  'button',
  '[href]',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((element) => {
    const hidden = element.getAttribute('aria-hidden') === 'true'
    const disabled =
      element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true'
    return !hidden && !disabled
  })
}

export function DestructiveConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  confirmingLabel = 'Deleting',
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
  className,
}: DestructiveConfirmationDialogProps) {
  const titleId = React.useId()
  const descriptionId = React.useId()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null)
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const timer = window.setTimeout(() => {
      cancelButtonRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [open])

  React.useEffect(() => {
    if (open) {
      setError(null)
      return
    }

    setPending(false)
    const previouslyFocused = previouslyFocusedRef.current
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus()
    }
  }, [open])

  if (!open) {
    return null
  }

  function cancel() {
    if (!pending) {
      onCancel()
    }
  }

  async function confirm() {
    if (pending) {
      return
    }

    setPending(true)
    setError(null)
    try {
      await onConfirm()
      onCancel()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed')
      setPending(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const panel = panelRef.current
    if (!panel) {
      return
    }

    const focusable = focusableElements(panel)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) {
      event.preventDefault()
      return
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          cancel()
        }
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          'bg-popover text-popover-foreground border-border w-full max-w-md rounded-md border p-4 shadow-lg',
          className
        )}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start gap-3">
          <div className="bg-destructive/10 text-destructive flex size-9 shrink-0 items-center justify-center rounded-md">
            <AlertTriangle className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <div
              id={descriptionId}
              className="text-muted-foreground mt-1 text-sm leading-6"
            >
              {description}
            </div>
          </div>
        </div>

        {error ? (
          <div className="text-destructive mt-3 text-sm" role="alert">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            disabled={pending}
            aria-label={cancelLabel}
            onClick={cancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            aria-label={pending ? confirmingLabel : confirmLabel}
            onClick={() => void confirm()}
          >
            {pending ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
