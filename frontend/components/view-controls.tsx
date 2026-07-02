'use client'

import * as React from 'react'
import { ListChecks, ListTodo, ListTree } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { modeSchema } from '@/lib/contracts'
import { cn } from '@/lib/utils'

export const MODES = modeSchema.options
export const OUTLINER_VIEWS = ['tree', 'up-next', 'follow-up'] as const

export type OutlinerView = (typeof OUTLINER_VIEWS)[number]

type ViewControlsProps = {
  view: OutlinerView
  onViewChange: (view: OutlinerView) => void
  className?: string
}

const VIEW_LABELS = {
  tree: 'Tree',
  'up-next': 'Up Next',
  'follow-up': 'Follow Up',
} satisfies Record<OutlinerView, string>

const VIEW_ARIA_LABELS = {
  tree: 'Show tree view',
  'up-next': 'Show up next work',
  'follow-up': 'Show follow up work',
} satisfies Record<OutlinerView, string>

function ViewIcon({ view }: { view: OutlinerView }) {
  const Icon =
    view === 'tree' ? ListTree : view === 'up-next' ? ListTodo : ListChecks
  return <Icon className="size-3.5" aria-hidden="true" />
}

export function ViewControls({
  view,
  onViewChange,
  className,
}: ViewControlsProps) {
  return (
    <div
      className={cn(
        'border-border bg-muted/30 inline-flex items-center gap-1 rounded-md border p-0.5',
        className
      )}
      aria-label="Outliner view"
    >
      {OUTLINER_VIEWS.map((option) => {
        const selected = option === view

        return (
          <Button
            key={option}
            type="button"
            variant={selected ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={selected}
            aria-label={VIEW_ARIA_LABELS[option]}
            title={VIEW_LABELS[option]}
            onClick={() => onViewChange(option)}
            className={cn(
              'h-8 gap-1.5 px-2.5',
              selected && 'border-foreground/20'
            )}
          >
            <ViewIcon view={option} />
            {VIEW_LABELS[option]}
          </Button>
        )
      })}
    </div>
  )
}
