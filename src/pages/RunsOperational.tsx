import { PilotRunHealth } from "../components/PilotRunHealth";
import { Loads } from "./Pages";

export function RunsOperational() {
  return (
    <div className="runs-operational-page">
      <section className="panel run-workflow-panel">
        <div className="title-row">
          <div>
            <p className="eyebrow">Run control</p>
            <h1>Planned runs & dispatch</h1>
          </div>
        </div>
        <p className="intro">
          This is the handover point between planning and live operations. Allocate the driver, vehicle and trailer, check the run, then preview and send the driver text before dispatch.
        </p>
        <div className="metrics run-workflow-steps">
          <article className="metric"><span>1</span><strong>Run built</strong><small>Accepted orders grouped into the run</small></article>
          <article className="metric"><span>2</span><strong>Allocate</strong><small>Driver · vehicle · trailer · start time</small></article>
          <article className="metric"><span>3</span><strong>Driver text</strong><small>Preview route, stops, notes and map links</small></article>
          <article className="metric"><span>4</span><strong>Dispatch</strong><small>Copy or send SMS, then move into live operations</small></article>
        </div>
        <p className="hint">
          Driver text controls appear against each allocated run below. The message is generated from the run, driver, vehicle, trailer and stop/order data so the planner can review it before sending.
        </p>
      </section>
      <PilotRunHealth />
      <Loads />
    </div>
  );
}
