import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Top-level render error boundary. Catches crashes from any descendant so a
 * single bad render doesn't blank the whole console. "Try again" resets state
 * so the user can recover without a full reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', { error, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
            gap: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ color: 'var(--color-text-tertiary)', fontSize: 14, maxWidth: 420 }}>
            {this.state.message ?? 'An unexpected error occurred.'}
          </p>
          <Button onClick={() => this.setState({ hasError: false, message: undefined })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
