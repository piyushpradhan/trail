import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: (err: Error, reset: () => void) => React.ReactNode;
}

interface State {
  err: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    console.error('Trail render error:', err, info);
  }

  reset = (): void => this.setState({ err: null });

  render(): React.ReactNode {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err, this.reset);
      return (
        <div className="error-fallback">
          <div className="error-title">Something broke</div>
          <pre className="error-stack">{this.state.err.message}</pre>
          <button className="btn-primary" onClick={this.reset}>Dismiss</button>
        </div>
      );
    }
    return this.props.children;
  }
}
