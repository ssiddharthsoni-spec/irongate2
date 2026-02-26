'use client';

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);

    try {
      // Report to Sentry if available in the global scope
      const Sentry = (globalThis as Record<string, unknown>).__SENTRY__;
      if (Sentry && typeof (Sentry as Record<string, unknown>).captureException === 'function') {
        (Sentry as { captureException: (e: Error, ctx?: unknown) => void }).captureException(error, {
          extra: { componentStack: errorInfo.componentStack },
        });
      }
    } catch {
      // Sentry not available — ignore
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const { error, showDetails } = this.state;

    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-full max-w-md rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 shrink-0 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg
                className="h-5 w-5 text-red-600 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Something went wrong
            </h3>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {error?.message || 'An unexpected error occurred.'}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
            >
              Try Again
            </button>

            <button
              onClick={() =>
                this.setState((s) => ({ showDetails: !s.showDetails }))
              }
              className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>

          {showDetails && error && (
            <pre className="mt-4 rounded-md bg-gray-100 dark:bg-gray-800 p-3 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto max-h-48 overflow-y-auto">
              {error.stack || error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
