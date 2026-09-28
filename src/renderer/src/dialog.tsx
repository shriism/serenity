import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * A modal dialog over the window. Focus moves into it when it opens, stays inside while it is open, and returns to
 * where it was when it closes; Escape or a click outside closes it.
 */
export function Dialog({ title, onClose, children, className = '', footer, hideTitle = false }: {
  title: string
  onClose(): void
  children: ReactNode
  className?: string
  footer?: ReactNode
  /** Keeps the title for assistive technology when the content supplies its own heading. */
  hideTitle?: boolean
}) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => (dialog.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea') ??
      dialog.current?.querySelector<HTMLElement>('button:not(.dialog-close)') ?? dialog.current)?.focus())
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  function keys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
      .filter((element) => element.offsetParent !== null)
    if (!focusable.length) return
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus() }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={keys}>
      {!hideTitle && <header className="dialog-header"><h2>{title}</h2>
        <button type="button" className="icon-btn dialog-close" onClick={onClose} aria-label="Close" title="Close"><X size={16}/></button></header>}
      {hideTitle && <button type="button" className="icon-btn dialog-close floating" onClick={onClose} aria-label="Close" title="Close"><X size={16}/></button>}
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </div>
  </div>
}
