import { Component, type ReactNode } from "react";

export class RuntimeBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error) {
    console.error("Application screen error:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="biz login">
        <section className="login-card">
          <h1>This screen could not load</h1>
          <p>
            Your saved database records remain on disk. Unsaved form fields may
            need to be entered again.
          </p>
          <p className="error">{this.state.error}</p>
          <button className="primary" onClick={() => location.reload()}>
            Reload application
          </button>
        </section>
      </div>
    );
  }
}
