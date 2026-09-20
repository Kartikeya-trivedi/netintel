import type { SVGProps, ReactNode } from 'react'

type SymbolProps = SVGProps<SVGSVGElement> & { size?: number }
function Symbol({
  size = 18,
  children,
  ...props
}: SymbolProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ArrowRight(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="M3 10h13m-5-5 5 5-5 5" />
    </Symbol>
  )
}
export function ArrowUpRight(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="m5 15 10-10M6 5h9v9" />
    </Symbol>
  )
}
export function ArrowLeftRight(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="M3 6h13l-3-3M17 14H4l3 3" />
    </Symbol>
  )
}
export function ChevronRight(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="m7 4 6 6-6 6" />
    </Symbol>
  )
}
export function Search(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <circle cx="8" cy="8" r="5" />
      <path d="m12 12 5 5" />
    </Symbol>
  )
}
export function Plus(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="M10 3v14M3 10h14" />
    </Symbol>
  )
}
export function Minus(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="M3 10h14" />
    </Symbol>
  )
}
export function Maximize(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="M7 3H3v4m10-4h4v4M3 13v4h4m6 0h4v-4" />
    </Symbol>
  )
}
export function X(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="m5 5 10 10M5 15 15 5" />
    </Symbol>
  )
}
export function Copy(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="M7 7h10v10H7zM3 13V3h10" />
    </Symbol>
  )
}
export function Check(props: SymbolProps) {
  return (
    <Symbol {...props}>
      <path d="m4 10 4 4 8-9" strokeWidth="2" />
    </Symbol>
  )
}
