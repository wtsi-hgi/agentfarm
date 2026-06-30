'use client'

import * as React from 'react'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type MarkdownContentProps = {
  value: string
  className?: string
}

type HeadingBlock = {
  kind: 'heading'
  level: 1 | 2 | 3 | 4
  text: string
}

type TextBlock = {
  kind: 'paragraph' | 'code'
  text: string
}

type ListBlock = {
  kind: 'ul' | 'ol'
  items: string[]
}

type TableBlock = {
  kind: 'table'
  headers: string[]
  rows: string[][]
}

type Block = HeadingBlock | TextBlock | ListBlock | TableBlock

function safeLinkHref(value: string): string | null {
  const trimmed = value.trim()

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? trimmed
      : null
  } catch {
    return null
  }
}

function splitTrailingUrlPunctuation(value: string) {
  const match = /^(.+?)([.,;:!?]*)$/.exec(value)
  return {
    href: match?.[1] ?? value,
    suffix: match?.[2] ?? '',
  }
}

function safeLink(
  href: string,
  children: React.ReactNode,
  key: string
): React.ReactNode {
  const safeHref = safeLinkHref(href)
  if (!safeHref) {
    return <React.Fragment key={key}>{children}</React.Fragment>
  }

  return (
    <a
      key={key}
      href={safeHref}
      target="_blank"
      rel="noreferrer"
      className="text-primary focus-visible:ring-ring rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    >
      {children}
    </a>
  )
}

function splitPipeCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitPipeCells(line)
  return (
    cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  )
}

function isMarkdownTable(lines: string[], index: number): boolean {
  const current = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return current.includes('|') && isMarkdownTableSeparator(next)
}

function isFence(line: string): string | null {
  const match = /^(```|~~~)/.exec(line.trim())
  return match?.[1] ?? null
}

function isAsciiLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) {
    return false
  }

  return (
    /[\u2500-\u257f]/.test(trimmed) ||
    (/^[+|].*[+|]$/.test(trimmed) && /[-+|]/.test(trimmed))
  )
}

function isUnorderedListLine(line: string): boolean {
  return /^\s*[-*]\s+\S/.test(line)
}

function isOrderedListLine(line: string): boolean {
  return /^\s*\d+\.\s+\S/.test(line)
}

function isTerminalLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^[$>] /.test(trimmed) || /^(PASS|FAIL|ERROR|WARN|INFO)\b/.test(trimmed)
  )
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return (
    Boolean(isFence(line)) ||
    /^#{1,4}\s+\S/.test(line) ||
    isMarkdownTable(lines, index) ||
    isAsciiLine(line) ||
    isUnorderedListLine(line) ||
    isOrderedListLine(line) ||
    /^(\t| {4})/.test(line)
  )
}

function parseBlocks(value: string): Block[] {
  const normalized = value.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = isFence(line)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index]?.trim().startsWith(fence)) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({ kind: 'code', text: codeLines.join('\n') })
      continue
    }

    if (isMarkdownTable(lines, index)) {
      const headers = splitPipeCells(lines[index] ?? '')
      index += 2
      const rows: string[][] = []
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        const row = lines[index] ?? ''
        if (!row.trim()) {
          break
        }
        rows.push(splitPipeCells(row))
        index += 1
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }

    if (isAsciiLine(line)) {
      const codeLines: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim()) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({ kind: 'code', text: codeLines.join('\n') })
      continue
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2],
      })
      index += 1
      continue
    }

    if (isUnorderedListLine(line)) {
      const items: string[] = []
      while (index < lines.length && isUnorderedListLine(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ul', items })
      continue
    }

    if (isOrderedListLine(line)) {
      const items: string[] = []
      while (index < lines.length && isOrderedListLine(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ol', items })
      continue
    }

    if (/^(\t| {4})/.test(line)) {
      const codeLines: string[] = []
      while (index < lines.length && /^(\t| {4}|$)/.test(lines[index] ?? '')) {
        codeLines.push((lines[index] ?? '').replace(/^(\t| {4})/, ''))
        index += 1
      }
      blocks.push({ kind: 'code', text: codeLines.join('\n').trimEnd() })
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !isBlockStart(lines, index)
    ) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }

    if (
      paragraphLines.length > 1 &&
      paragraphLines.some((paragraphLine) => isTerminalLine(paragraphLine))
    ) {
      blocks.push({ kind: 'code', text: paragraphLines.join('\n') })
    } else {
      blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
    }
  }

  return blocks
}

function inlineContent(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"'`]+))/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let index = 0

  for (const match of text.matchAll(pattern)) {
    const token = match[0]
    const tokenIndex = match.index ?? 0
    if (tokenIndex > lastIndex) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}-text-${index}`}>
          {text.slice(lastIndex, tokenIndex)}
        </React.Fragment>
      )
      index += 1
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`}>
          {inlineContent(token.slice(2, -2), `${keyPrefix}-strong-${index}`)}
        </strong>
      )
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const safeHref = safeLinkHref(match[3])
      nodes.push(
        safeHref ? (
          safeLink(
            safeHref,
            inlineContent(match[2], `${keyPrefix}-link-${index}`),
            `${keyPrefix}-link-${index}`
          )
        ) : (
          <React.Fragment key={`${keyPrefix}-unsafe-link-${index}`}>
            {token}
          </React.Fragment>
        )
      )
    } else {
      const { href, suffix } = splitTrailingUrlPunctuation(token)
      nodes.push(safeLink(href, href, `${keyPrefix}-bare-link-${index}`))
      if (suffix) {
        nodes.push(
          <React.Fragment key={`${keyPrefix}-bare-link-suffix-${index}`}>
            {suffix}
          </React.Fragment>
        )
      }
    }

    lastIndex = tokenIndex + token.length
    index += 1
  }

  if (lastIndex < text.length) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}-text-${index}`}>
        {text.slice(lastIndex)}
      </React.Fragment>
    )
  }

  return nodes
}

function headingClass(level: HeadingBlock['level']) {
  switch (level) {
    case 1:
      return 'text-base font-semibold'
    case 2:
      return 'text-sm font-semibold'
    default:
      return 'text-sm font-medium'
  }
}

export function MarkdownContent({ value, className }: MarkdownContentProps) {
  const blocks = React.useMemo(() => parseBlocks(value), [value])
  const [copiedBlockKey, setCopiedBlockKey] = React.useState<string | null>(
    null
  )
  const [canCopy, setCanCopy] = React.useState(false)

  React.useEffect(() => {
    setCanCopy(typeof navigator.clipboard?.writeText === 'function')
  }, [])

  async function copyCodeBlock(text: string, key: string) {
    if (!canCopy || typeof navigator.clipboard?.writeText !== 'function') {
      return
    }

    await navigator.clipboard.writeText(text)
    setCopiedBlockKey(key)
  }

  return (
    <div className={cn('space-y-3 text-sm leading-6', className)}>
      {blocks.map((block, blockIndex) => {
        const key = `${block.kind}-${blockIndex}`
        switch (block.kind) {
          case 'heading': {
            const HeadingTag = block.level === 1 ? 'h3' : 'h4'
            return (
              <HeadingTag
                key={key}
                className={cn('text-foreground', headingClass(block.level))}
              >
                {inlineContent(block.text, key)}
              </HeadingTag>
            )
          }
          case 'ul':
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {block.items.map((item, index) => (
                  <li key={`${key}-${index}`}>
                    {inlineContent(item, `${key}-${index}`)}
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={key} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, index) => (
                  <li key={`${key}-${index}`}>
                    {inlineContent(item, `${key}-${index}`)}
                  </li>
                ))}
              </ol>
            )
          case 'table':
            return (
              <div
                key={key}
                className="border-border overflow-x-auto rounded-md border"
              >
                <table className="w-full min-w-max border-collapse text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {block.headers.map((header, index) => (
                        <th
                          key={`${key}-header-${index}`}
                          className="border-border border-b px-3 py-2 font-medium"
                        >
                          {inlineContent(header, `${key}-header-${index}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-row-${rowIndex}`}>
                        {block.headers.map((_, cellIndex) => (
                          <td
                            key={`${key}-cell-${rowIndex}-${cellIndex}`}
                            className="border-border border-t px-3 py-2 align-top"
                          >
                            {inlineContent(
                              row[cellIndex] ?? '',
                              `${key}-cell-${rowIndex}-${cellIndex}`
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'code': {
            const copied = copiedBlockKey === key
            return (
              <div key={key} className="relative">
                <pre className="bg-muted/70 border-border overflow-x-auto rounded-md border p-3 pr-12 text-xs leading-5">
                  <code className="font-mono whitespace-pre">{block.text}</code>
                </pre>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={!canCopy}
                        aria-label={
                          copied ? 'Copied code block' : 'Copy code block'
                        }
                        className="bg-background/80 absolute top-1.5 right-1.5 size-7"
                        onClick={() => void copyCodeBlock(block.text, key)}
                      >
                        {copied ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {copied ? 'Copied code block' : 'Copy code block'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )
          }
          case 'paragraph':
            return (
              <p key={key} className="text-foreground whitespace-pre-wrap">
                {inlineContent(block.text, key)}
              </p>
            )
        }
      })}
    </div>
  )
}
