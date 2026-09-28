import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from 'react'
import { dragDivider, type LayoutDivider, type LayoutRect } from '../../shared/layout'

/** Data type carried by a dragged tab: `{ group, key }`. */
export const tabDragType = 'application/x-serenity-tab'

export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** Dropping near a pane's edge splits it toward that edge; elsewhere the tab moves into the pane. */
export function dropZoneAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): DropZone {
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const edge = 0.22
  const distances: [DropZone, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]]
  const [zone, distance] = distances.reduce((closest, item) => item[1] < closest[1] ? item : closest)
  return distance < edge ? zone : 'center'
}

export const percentRect = (rect: LayoutRect): CSSProperties =>
  ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` })

/** A draggable, keyboard-operable boundary between two panes. Double-click evens out its split. */
export function PaneDivider({ divider, area, onResize, onReset }: {
  divider: LayoutDivider
  /** The element all pane rectangles are fractions of. */
  area: RefObject<HTMLElement | null>
  onResize(path: number[], sizes: number[]): void
  onReset(path: number[]): void
}) {
  const row = divider.direction === 'row'
  const boundary = divider.sizes.slice(0, divider.index).reduce((sum, size) => sum + size, 0)
  const resizeTo = (position: number): void => onResize(divider.path, dragDivider(divider.sizes, divider.index, position))
  const pointer = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = area.current?.getBoundingClientRect()
    if (!bounds) return
    const start = row ? bounds.left + divider.area.x * bounds.width : bounds.top + divider.area.y * bounds.height
    const length = row ? divider.area.width * bounds.width : divider.area.height * bounds.height
    resizeTo(((row ? event.clientX : event.clientY) - start) / length)
  }
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.03
    const next = event.key === (row ? 'ArrowLeft' : 'ArrowUp') ? boundary - step : event.key === (row ? 'ArrowRight' : 'ArrowDown') ? boundary + step :
      event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null
    if (next === null) return
    event.preventDefault()
    resizeTo(next)
  }
  return <div role="separator" tabIndex={0} aria-orientation={row ? 'vertical' : 'horizontal'} aria-label="Resize panes"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boundary * 100)}
    className={`pane-divider ${row ? 'row' : 'column'}`} style={percentRect(divider.line)}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pointer(event) }}
    onDoubleClick={() => onReset(divider.path)} onKeyDown={keys}
    // A drag should not leave the divider focused, or the next key press would light up its focus ring.
    onMouseDown={(event) => event.preventDefault()}/>
}
