import type { Scratchpad } from '@/lib/contracts'

export const SCRATCHPAD_MIN_HEIGHT = 120
export const SCRATCHPAD_MAX_HEIGHT = 640
export const SCRATCHPAD_SAVE_DELAY_MS = 300
export const SCRATCHPAD_SAVED_STATUS_MS = 2000

export const DEFAULT_SCRATCHPAD: Scratchpad = {
  body: '',
  height: 220,
  minimized: true,
  updated_by: null,
  updated_at: null,
}
