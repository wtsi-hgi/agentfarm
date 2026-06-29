'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Mode, TreeItem } from '@/lib/contracts'
import { cn } from '@/lib/utils'

export const MODE_COLOUR_MAP = {
  'prompt-agent': 'border-l-cyan-500',
  review: 'border-l-amber-500',
  merge: 'border-l-emerald-500',
  release: 'border-l-rose-500',
  spec: 'border-l-violet-500',
} satisfies Record<Mode, string>

type OutlinerRowProps = {
  item: TreeItem
  depth: number
  hasChildren: boolean
  collapsed: boolean
  onToggle: (itemId: string) => void
}

export function OutlinerRow({
  item,
  depth,
  hasChildren,
  collapsed,
  onToggle,
}: OutlinerRowProps) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          'grid min-h-10 grid-cols-[auto_1fr_auto] items-center gap-2 border-l-4 py-1.5 pr-2',
          MODE_COLOUR_MAP[item.mode],
          item.complete && 'text-muted-foreground',
          item.blocked_external && 'text-muted-foreground'
        )}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
        data-mode={item.mode}
      >
        <div className="flex size-8 items-center justify-center">
          {hasChildren ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={collapsed ? 'Expand item' : 'Collapse item'}
                  aria-expanded={!collapsed}
                  onClick={() => onToggle(item.id)}
                >
                  {collapsed ? (
                    <ChevronRight className="size-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {collapsed ? 'Expand' : 'Collapse'}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="bg-muted-foreground/60 size-1.5 rounded-full" />
          )}
        </div>

        <div className="min-w-0">
          <div className="text-foreground truncate font-medium">
            {item.title}
          </div>
          {item.needs.length > 0 ? (
            <div className="text-muted-foreground truncate text-xs">
              {item.needs.map((need) => `>${need}`).join(' ')}
            </div>
          ) : null}
        </div>

        <span
          className={cn(
            'border-border text-muted-foreground rounded-sm border px-2 py-0.5 text-xs',
            item.actionable && !item.complete && 'text-foreground',
            item.complete && 'bg-muted'
          )}
        >
          {item.complete ? 'Done' : item.actionable ? 'Ready' : 'Waiting'}
        </span>
      </div>
    </TooltipProvider>
  )
}
