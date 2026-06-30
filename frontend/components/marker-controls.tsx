'use client'

import * as React from 'react'
import { Calendar, Flag, Filter, X } from 'lucide-react'

import { createMarker, fetchChanges, fetchMarkers } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Marker, MarkerChangeField } from '@/lib/contracts'
import { cn } from '@/lib/utils'

type MarkerControlsProps = {
  initialMarkers?: readonly Marker[]
  onFilterChange: (itemIds: readonly string[] | null) => void
  className?: string
}

const CHANGE_FIELDS = [
  { value: 'changed', label: 'Changed' },
  { value: 'created', label: 'Created' },
  { value: 'completed', label: 'Completed' },
] satisfies readonly { value: MarkerChangeField; label: string }[]

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MarkerControls({
  initialMarkers = [],
  onFilterChange,
  className,
}: MarkerControlsProps) {
  const [markers, setMarkers] = React.useState<Marker[]>(() => [
    ...initialMarkers,
  ])
  const [name, setName] = React.useState('')
  const [sinceId, setSinceId] = React.useState('')
  const [untilId, setUntilId] = React.useState('')
  const [field, setField] = React.useState<MarkerChangeField>('changed')
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const loadMarkers = React.useCallback(async () => {
    try {
      setMarkers(await fetchMarkers())
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to load markers'
      )
    }
  }, [])

  React.useEffect(() => {
    void loadMarkers()
  }, [loadMarkers])

  async function createNamedMarker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      return
    }

    setError(null)
    try {
      const marker = await createMarker({ name: name.trim() })
      setName('')
      const replacedMarkerIds = new Set(
        markers
          .filter((existing) => existing.name === marker.name)
          .map((existing) => existing.id)
      )
      setMarkers((current) => [
        ...current.filter((existing) => existing.name !== marker.name),
        marker,
      ])
      setSinceId(marker.id)
      setUntilId((current) => (replacedMarkerIds.has(current) ? '' : current))
      setStatus(`${marker.name} marked`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to mark')
    }
  }

  async function applyMarkerFilter() {
    if (!sinceId) {
      return
    }

    setError(null)
    try {
      const changedItems = await fetchChanges(
        untilId
          ? { between: [sinceId, untilId], field }
          : { since: sinceId, field }
      )
      onFilterChange(changedItems.map((item) => item.id))
      setStatus(`${changedItems.length} ${field}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to filter')
    }
  }

  function clearMarkerFilter() {
    onFilterChange(null)
    setStatus(null)
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      aria-label="Marker controls"
    >
      <form className="flex items-center gap-1.5" onSubmit={createNamedMarker}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Marker name"
          placeholder="Marker"
          className="h-8 w-32"
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-8"
                aria-label="Use today as marker name"
                onClick={() => setName(formatLocalDate(new Date()))}
              >
                <Calendar className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Use today</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          type="submit"
          size="icon"
          className="size-8"
          aria-label="Create marker"
          disabled={!name.trim()}
        >
          <Flag className="size-3.5" aria-hidden="true" />
        </Button>
      </form>

      <select
        value={sinceId}
        onChange={(event) => setSinceId(event.target.value)}
        aria-label="Since marker"
        className="border-border bg-background h-8 rounded-md border px-2 text-sm"
      >
        <option value="">Since</option>
        {markers.map((marker) => (
          <option key={marker.id} value={marker.id}>
            {marker.name}
          </option>
        ))}
      </select>

      <select
        value={untilId}
        onChange={(event) => setUntilId(event.target.value)}
        aria-label="Until marker"
        className="border-border bg-background h-8 rounded-md border px-2 text-sm"
      >
        <option value="">Now</option>
        {markers.map((marker) => (
          <option key={marker.id} value={marker.id}>
            {marker.name}
          </option>
        ))}
      </select>

      <select
        value={field}
        onChange={(event) => setField(event.target.value as MarkerChangeField)}
        aria-label="Change field"
        className="border-border bg-background h-8 rounded-md border px-2 text-sm"
      >
        {CHANGE_FIELDS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-8"
        aria-label="Apply marker filter"
        disabled={!sinceId}
        onClick={() => void applyMarkerFilter()}
      >
        <Filter className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Clear marker filter"
        onClick={clearMarkerFilter}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
      {status ? (
        <span className="text-muted-foreground text-xs">{status}</span>
      ) : null}
      {error ? (
        <span className="text-destructive text-xs" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
