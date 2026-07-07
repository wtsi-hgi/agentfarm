import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type NativeDateInputProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  | 'aria-label'
  | 'aria-labelledby'
  | 'children'
  | 'defaultValue'
  | 'onChange'
  | 'type'
  | 'value'
>

type DateInputAccessibleName =
  | {
      label: React.ReactNode
      'aria-label'?: string
      'aria-labelledby'?: string
    }
  | {
      label?: never
      'aria-label': string
      'aria-labelledby'?: string
    }
  | {
      label?: never
      'aria-label'?: string
      'aria-labelledby': string
    }

type DateInputProps = NativeDateInputProps &
  DateInputAccessibleName & {
    inputClassName?: string
    onChange: (value: string) => void
    value: string
  }

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    { className, id, inputClassName, label, onChange, value, ...props },
    ref
  ) => {
    const generatedId = React.useId()
    const inputId = id ?? generatedId
    const hasVisibleLabel = label !== undefined && label !== null

    return (
      <div className={cn('grid gap-2', className)}>
        {hasVisibleLabel ? (
          <label
            className="text-foreground text-sm leading-none font-medium"
            htmlFor={inputId}
          >
            {label}
          </label>
        ) : null}
        <Input
          {...props}
          className={inputClassName}
          id={inputId}
          onChange={(event) => onChange(event.currentTarget.value)}
          ref={ref}
          type="date"
          value={value}
        />
      </div>
    )
  }
)
DateInput.displayName = 'DateInput'

export { DateInput, type DateInputProps }
