import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, Copy, X } from './Symbols'

export function Button({
  variant = 'quiet',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'quiet' | 'primary' | 'danger' | 'link'
}) {
  return (
    <button
      type="button"
      {...props}
      className={`button button-${variant} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`icon-button ${className}`}
    >
      {children}
    </button>
  )
}

export type Tone = 'neutral' | 'lead' | 'supported' | 'signal' | 'muted'
export function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode
  tone?: Tone
  title?: string
}) {
  return (
    <span title={title} className={`meta-tag meta-tag-${tone}`}>
      {children}
    </span>
  )
}

export function FieldLabel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <span className={`field-label ${className}`}>{children}</span>
}

export function PageHeader({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow?: string
  title: ReactNode
  children?: ReactNode
  aside?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-2 text-sm font-medium text-muted">{eyebrow}</p>
          )}
          <h1>{title}</h1>
        </div>
        {aside}
      </div>
      {children && (
        <div className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          {children}
        </div>
      )}
    </header>
  )
}

export function Card({
  title,
  aside,
  children,
  className = '',
}: {
  title?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-heading">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({
  value,
  label,
  accent = false,
}: {
  value: ReactNode
  label: string
  accent?: boolean
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd
        className={`numeric mt-2 text-2xl font-semibold ${accent ? 'text-primary' : 'text-heading'}`}
      >
        {value}
      </dd>
    </div>
  )
}

export function StatStrip({
  cells,
}: {
  cells: { label: string; value: ReactNode; title?: string }[]
}) {
  return (
    <div className="stats-container">
      <dl
        className={`stat-strip ${cells.length === 8 ? 'stat-strip-eight' : ''}`}
      >
        {cells.map((cell) => (
          <div key={cell.label} title={cell.title}>
            <dt>{cell.label}</dt>
            <dd>{cell.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="loading-state">
      <span className="loading-indicator" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}…</span>
    </div>
  )
}

export function LoadingPane({
  label = 'Loading workspace',
  compact = false,
}: {
  label?: string
  compact?: boolean
}) {
  return (
    <div
      className={`loading-pane ${compact ? 'loading-pane-compact' : ''}`}
      aria-busy="true"
    >
      <LoadingState label={label} />
      <div className="loading-placeholder" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="loading-placeholder" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {!compact && (
        <div className="loading-placeholder" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="empty-note">
      <p>{children}</p>
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{children}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="error-note">
      <div>
        <p className="font-semibold">Request failed</p>
        <p className="mt-1 break-words">{message}</p>
      </div>
    </div>
  )
}

export function Callout({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'signal' | 'lead'
}) {
  return (
    <div className={`callout callout-${tone}`}>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function SectionHeading({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="section-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>{title}</h2>
        {aside}
      </div>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  initialFocus,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  initialFocus?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement as HTMLElement | null
    if (open && dialog && !dialog.open) {
      dialog.showModal()
      if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus()
    }
    if (!open && dialog?.open) dialog.close()
    return () => {
      if (dialog?.open) dialog.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open, initialFocus])
  return createPortal(
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="dialog-body">
        <header>
          <h2 id={id}>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>,
    document.body,
  )
}

export function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string
  label?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setState('copied')
        } catch {
          setState('failed')
        }
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState('idle'), 2000)
      }}
    >
      {state === 'copied' ? <Check size={15} /> : <Copy size={15} />}
      <span aria-live="polite">
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Copy unavailable'
            : label}
      </span>
    </Button>
  )
}

export function TextLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {children}
      <ChevronRight size={15} aria-hidden="true" />
    </span>
  )
}
