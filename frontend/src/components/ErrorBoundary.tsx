import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);

    // Report to Sentry if available
    try {
      import("@sentry/react").then((Sentry) => {
        Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
      });
    } catch {
      // Sentry not available — ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[60vh] items-center justify-center">
          <div className="card max-w-md p-8 text-center">
            <AlertTriangle size={40} className="mx-auto mb-4 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
            <p className="mt-2 text-sm text-slate-400">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="btn-primary mt-6 text-sm"
            >
              <RefreshCw size={14} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
