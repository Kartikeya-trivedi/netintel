import { useEffect, useRef, type ReactNode } from 'react'

/** A small, keyboard-accessible disclosure for secondary controls. */
export default function Popover({
  label,
  children,
  className = '',
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  function place() {
    if (!ref.current?.open || !panel.current) return
    panel.current.style.transform = ''
    const box = panel.current.getBoundingClientRect()
    const shift =
      box.left < 18
        ? 18 - box.left
        : box.right > innerWidth - 18
          ? innerWidth - 18 - box.right
          : 0
    panel.current.style.transform = `translateX(${shift}px)`
  }
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (
        ref.current?.open &&
        event.target instanceof Node &&
        !ref.current.contains(event.target)
      )
        ref.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', place)
    }
  }, [])
  return (
    <details
      ref={ref}
      onToggle={place}
      className={`control-popover ${className}`}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          event.currentTarget.open = false
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.currentTarget.open = false
          event.currentTarget.querySelector('summary')?.focus()
        }
      }}
    >
      <summary>
        {label}
        <span className="popover-chevron" aria-hidden="true" />
      </summary>
      <div ref={panel} className="control-popover-body">
        {children}
      </div>
    </details>
  )
}
