import { useEffect, useState } from 'react'

/** Tracks an element's rendered width.
 *
 *  Charts drawn in plain SVG are laid out at their real pixel width rather
 *  than scaled with a viewBox, so type stays at its set size at any width.
 *  Returns a callback ref; a hidden element (a tab not on screen) reads 0,
 *  and callers draw nothing until it has a width.
 */
export function useElementWidth<T extends HTMLElement>(): [(element: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!element) return
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width))
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, width]
}
