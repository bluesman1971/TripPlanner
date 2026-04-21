import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="p-8 text-center">
          <p className="font-medium text-gray-800">Something went wrong</p>
          <p className="text-sm text-gray-500 mt-1">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 text-sm text-slate-600 underline hover:text-slate-900"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
