import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps a rendering failure in one part of the workbench from blanking the window. Workspace files are only changed
 * through validated operations, so a view that fails to draw has not altered anything on disk.
 */
export class ErrorBoundary extends Component<{ label: string; children: ReactNode; fullScreen?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label} failed to render`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return <section className={`page view-error ${this.props.fullScreen ? 'full-screen' : ''}`} role="alert">
      <h1>{this.props.fullScreen ? 'Serenity hit an unexpected problem' : `${this.props.label} couldn’t be shown`}</h1>
      <p>Nothing in your workspace was changed. {this.props.fullScreen ? 'Reloading the window usually recovers.' : 'Other panes keep working, and you can try this view again.'}</p>
      <pre>{error.message}</pre>
      <div className="view-error-actions">
        {this.props.fullScreen ? <button className="primary" onClick={() => window.location.reload()}>Reload window</button>
          : <button className="primary" onClick={() => this.setState({ error: null })}>Try again</button>}
      </div>
    </section>
  }
}
