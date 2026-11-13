import { Component, type ReactNode } from 'react';

/** A render failure stays with the individual card or message; never unmount the dashboard. */
export class ChatErrorBoundary extends Component<{ children: ReactNode; message?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="tw:m-0 tw:rounded-xl tw:border tw:border-ck-line tw:px-3 tw:py-2 tw:text-xs tw:text-ck-muted" role="alert">{this.props.message ?? 'Nie da się pokazać tej karty: agent przysłał nieoczekiwane dane.'}</p>
      : this.props.children;
  }
}
