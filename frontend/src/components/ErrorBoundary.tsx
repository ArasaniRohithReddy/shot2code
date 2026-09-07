import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, a render error unmounts the whole tree and the window simply
 * goes blank - which in the desktop app looks identical to the backend failing
 * to start. Showing the error (and logging it) makes the difference obvious.
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("shot2code crashed while rendering:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="max-w-md text-sm text-gray-600 dark:text-zinc-400">
          shot2code hit an unexpected error while drawing this screen. Reloading
          usually fixes it. If it keeps happening, resetting saved settings
          clears any bad stored state.
        </p>
        <pre className="max-w-xl overflow-auto rounded bg-gray-100 p-3 text-left text-xs text-red-700 dark:bg-zinc-800 dark:text-red-300">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            onClick={() => {
              try {
                window.localStorage.removeItem("setting");
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
          >
            Reset settings and reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
