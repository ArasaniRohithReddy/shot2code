import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  height: number;
  onError: (message: string) => void;
}

interface State {
  failed: boolean;
}

class ReviewFrameBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(
      error.message || "The preview frame could not be prepared for review."
    );
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="status"
          className="flex items-center justify-center bg-red-50 px-6 text-center text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
          style={{ height: `${this.props.height}px` }}
        >
          This viewport could not render. Other viewport results and source
          checks remain available.
        </div>
      );
    }
    return this.props.children;
  }
}

export default ReviewFrameBoundary;
