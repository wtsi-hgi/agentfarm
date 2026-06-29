'use client'

import * as React from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { modeSchema, type Mode } from '@/lib/contracts'
import { cn } from '@/lib/utils'

export const MODES = modeSchema.options

type ModeTogglesProps = {
  selectedModes: ReadonlySet<Mode>
  onSelectedModesChange: (selectedModes: Set<Mode>) => void
  className?: string
}

const MODE_LABELS = {
  'prompt-agent': 'Prompt',
  review: 'Review',
  merge: 'Merge',
  release: 'Release',
  spec: 'Spec',
} satisfies Record<Mode, string>

export function ModeToggles({
  selectedModes,
  onSelectedModesChange,
  className,
}: ModeTogglesProps) {
  function toggleMode(mode: Mode) {
    const next = new Set(selectedModes)
    if (next.has(mode)) {
      next.delete(mode)
    } else {
      next.add(mode)
    }
    onSelectedModesChange(next)
  }

  return (
    <TooltipProvider>
      <div
        className={cn('flex flex-wrap items-center gap-1.5', className)}
        aria-label="Mode filters"
      >
        {MODES.map((mode) => {
          const selected = selectedModes.has(mode)

          return (
            <Tooltip key={mode}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={selected}
                  aria-label={`${MODE_LABELS[mode]} mode`}
                  onClick={() => toggleMode(mode)}
                  className={cn(
                    'h-8 gap-1.5 px-2.5',
                    selected && 'border-foreground/20'
                  )}
                >
                  {selected ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : null}
                  {MODE_LABELS[mode]}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{MODE_LABELS[mode]}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
