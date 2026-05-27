'use client';
import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; tabName: string; }
interface State { hasError: boolean; error?: Error; }

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="text-4xl">⚠️</div>
          <h3 className="text-lg font-semibold text-slate-700">
            Something went wrong in the {this.props.tabName} tab
          </h3>
          <p className="text-sm text-slate-500 max-w-sm">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
