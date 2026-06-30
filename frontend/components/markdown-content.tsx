'use client'

import * as React from 'react'

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
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={`${keyPrefix}-code-${index}`}
          className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-strong-${index}`}>
          {part.slice(2, -2)}
        </strong>
      )
    }

    return (
      <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
    )
  })
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
          case 'code':
            return (
              <pre
                key={key}
                className="bg-muted/70 border-border overflow-x-auto rounded-md border p-3 text-xs leading-5"
              >
                <code className="font-mono whitespace-pre">{block.text}</code>
              </pre>
            )
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
