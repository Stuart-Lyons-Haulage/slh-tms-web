import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { OperationalPlanner } from "./OperationalPlanner";

type State = { error?: Error };

class PlannerBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Operational planner failed", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Planner recovery</p>
          <h1>Planner workspace is still available</h1>
          <p className="intro">A planner panel failed to render. You have not been signed out and can continue through jobs and runs while the panel is retried.</p>
        </div>
        <button className="primary" onClick={() => this.setState({ error: undefined })}>Retry planner</button>
      </div>
      <div className="panel">
        <strong>Application error</strong>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{this.state.error.name}: {this.state.error.message}</pre>
      </div>
      <div className="metrics">
        <Link className="panel" to="/jobs"><strong>Manage jobs</strong><span>Edit or cancel imported work</span></Link>
        <Link className="panel" to="/loads"><strong>Runs</strong><span>Continue allocation and dispatch</span></Link>
        <Link className="panel" to="/staging"><strong>Order Review</strong><span>Approve staged imports</span></Link>
      </div>
    </section>;
  }
}

export function StablePlanner() {
  return <PlannerBoundary><OperationalPlanner /></PlannerBoundary>;
}
