import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Root error boundary — catches unhandled errors and shows a recovery UI */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="flex flex-col items-center justify-center h-screen gap-6"
        style={{ background: "var(--dream-bg, #0a0e27)", color: "var(--dream-text, #fff)" }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: "color-mix(in srgb, #ef4444 15%, transparent)" }}
        >
          <span className="text-2xl">⚠️</span>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm opacity-60 mb-1">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
        </div>
        <button
          onClick={this.handleRetry}
          className="px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: "var(--dream-accent, #6366f1)" }}
        >
          Try Again
        </button>
      </div>
    );
  }
}
