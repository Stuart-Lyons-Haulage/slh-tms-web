import { PilotRunHealth } from "../components/PilotRunHealth";
import { AllocationBoard } from "./Pages";

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
          <article className="metric"><span>3</span><strong>Driver text</strong><small>Copy the driver brief or send SMS from the run card</small></article>
          <article className="metric"><span>4</span><strong>Dispatch</strong><small>Copy/send after checking the run, then move into live operations</small></article>
        </div>
        <p className="hint">
          Use the allocation cards below the live health panel. Each run card has driver, vehicle and trailer dropdowns, then Copy for MightyText and Send driver SMS once the run is ready.
        </p>
      </section>
      <PilotRunHealth />
      <AllocationBoard />
    </div>
  );
}
