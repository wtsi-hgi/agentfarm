const LOCAL_BROWSER_ORIGINS = ['localhost', '127.0.0.1', '[::1]']
const WILDCARD_BIND_HOSTS = new Set(['0.0.0.0', '::', '[::]'])
const INVALID_WILDCARD_ORIGINS = new Set(['*', '**'])

export type DevOriginOptions = {
  frontendHost?: string
  machineHostname?: string
  extraOrigins?: string
}

function splitOriginList(origins: string | undefined): string[] {
  return origins?.split(/[,\s]+/).filter(Boolean) ?? []
}

export function normalizeDevOrigin(origin: string | undefined): string | null {
  const candidate = origin?.trim().toLowerCase()
  if (!candidate || INVALID_WILDCARD_ORIGINS.has(candidate)) {
    return null
  }

  if (candidate.startsWith('*.') || candidate.startsWith('**.')) {
    return candidate
  }

  try {
    const parsed = new URL(
      candidate.includes('://') ? candidate : `https://${candidate}`
    )
    return parsed.hostname
  } catch {
    if (candidate.includes(':') && !candidate.startsWith('[')) {
      try {
        return new URL(`https://[${candidate}]`).hostname
      } catch {
        return null
      }
    }
    return null
  }
}

export function buildAllowedDevOrigins({
  frontendHost,
  machineHostname,
  extraOrigins,
}: DevOriginOptions): string[] {
  const origins = new Set<string>()

  for (const origin of LOCAL_BROWSER_ORIGINS) {
    origins.add(origin)
  }

  for (const origin of [
    frontendHost,
    machineHostname,
    ...splitOriginList(extraOrigins),
  ]) {
    const normalized = normalizeDevOrigin(origin)
    if (normalized && !WILDCARD_BIND_HOSTS.has(normalized)) {
      origins.add(normalized)
    }
  }

  return [...origins]
}
