'use client'

import { ChevronRight } from 'lucide-react'

import type { TreeItem } from '@/lib/contracts'

export type ItemDialogBreadcrumb = Pick<TreeItem, 'id' | 'title'>

type ItemDialogHeadingProps = {
  ancestors?: readonly ItemDialogBreadcrumb[]
  item: Pick<TreeItem, 'title'>
  titleId: string
}

export function ItemDialogHeading({
  ancestors = [],
  item,
  titleId,
}: ItemDialogHeadingProps) {
  return (
    <>
      {ancestors.length > 0 ? (
        <nav
          aria-label="Item location"
          className="text-muted-foreground mt-1 overflow-hidden text-xs"
        >
          <ol className="flex min-w-0 items-center gap-1">
            {ancestors.map((ancestor, index) => (
              <li
                key={ancestor.id}
                className="flex min-w-0 shrink items-center gap-1"
              >
                <span className="truncate">{ancestor.title}</span>
                {index < ancestors.length - 1 ? (
                  <ChevronRight
                    className="size-3 shrink-0"
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h2
        id={titleId}
        className="text-foreground mt-1 truncate text-lg font-semibold"
      >
        {item.title}
      </h2>
    </>
  )
}
