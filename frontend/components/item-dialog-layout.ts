import * as React from 'react'

// Tailwind arbitrary values encode calc spaces as underscores.
export const ITEM_DIALOG_HISTORY_CLASS =
  'min-h-0 overflow-y-auto px-4 py-4 sm:px-5 lg:h-[calc(100%_-_var(--scratchpad-reserved-bottom))] lg:self-start'

let activePageScrollLocks = 0
let lockedWindowScrollX = 0
let lockedWindowScrollY = 0

function canScrollVertically(element: HTMLElement, deltaY: number) {
  if (deltaY === 0) {
    return false
  }

  const style = window.getComputedStyle(element)
  if (!['auto', 'scroll', 'overlay'].includes(style.overflowY)) {
    return false
  }

  const maxScrollTop = element.scrollHeight - element.clientHeight
  if (maxScrollTop <= 0) {
    return false
  }

  if (deltaY > 0) {
    return element.scrollTop < maxScrollTop - 1
  }

  return element.scrollTop > 1
}

function canWheelScrollVisibleDialogBox(event: WheelEvent) {
  if (!(event.target instanceof Element)) {
    return false
  }

  const containmentRoot = event.target.closest(
    '[data-item-dialog-panel="true"], [data-scratchpad-panel="true"]'
  )
  if (!containmentRoot) {
    return false
  }

  let element: Element | null = event.target
  while (element && containmentRoot.contains(element)) {
    if (
      element instanceof HTMLElement &&
      canScrollVertically(element, event.deltaY)
    ) {
      return true
    }
    element = element.parentElement
  }

  return false
}

function containDialogWheelScroll(event: WheelEvent) {
  if (!canWheelScrollVisibleDialogBox(event)) {
    event.preventDefault()
  }
}

function restoreLockedWindowScroll() {
  if (
    window.scrollX !== lockedWindowScrollX ||
    window.scrollY !== lockedWindowScrollY
  ) {
    window.scrollTo(lockedWindowScrollX, lockedWindowScrollY)
  }
}

export function useItemDialogPageScrollLock() {
  React.useLayoutEffect(() => {
    if (activePageScrollLocks === 0) {
      lockedWindowScrollX = window.scrollX
      lockedWindowScrollY = window.scrollY
      document.addEventListener('wheel', containDialogWheelScroll, {
        capture: true,
        passive: false,
      })
    }

    activePageScrollLocks += 1

    return () => {
      activePageScrollLocks = Math.max(0, activePageScrollLocks - 1)

      if (activePageScrollLocks === 0) {
        document.removeEventListener('wheel', containDialogWheelScroll, {
          capture: true,
        })
        restoreLockedWindowScroll()
      }
    }
  }, [])
}
