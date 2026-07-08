import * as React from 'react'

// Tailwind arbitrary values encode calc spaces as underscores.
export const ITEM_DIALOG_HISTORY_CLASS =
  'min-h-0 overflow-y-auto px-4 py-4 sm:px-5 lg:h-[calc(100%_-_var(--scratchpad-reserved-bottom))] lg:self-start'

let activePageScrollLocks = 0
let previousBodyOverflow = ''
let previousDocumentOverflow = ''

export function useItemDialogPageScrollLock() {
  React.useEffect(() => {
    if (activePageScrollLocks === 0) {
      previousBodyOverflow = document.body.style.overflow
      previousDocumentOverflow = document.documentElement.style.overflow
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    }

    activePageScrollLocks += 1

    return () => {
      activePageScrollLocks = Math.max(0, activePageScrollLocks - 1)

      if (activePageScrollLocks === 0) {
        document.body.style.overflow = previousBodyOverflow
        document.documentElement.style.overflow = previousDocumentOverflow
      }
    }
  }, [])
}
