import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CustomerCommunication } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

const purposeLabel: Record<string, string> = { EtaUpdate: "ETA update", LoadPlan: "Load plan", Exception: "Exception", Other: "Other" };

export function CustomerCommunications() {
  const token = useAccessToken();
  const [status, setStatus] = useState("PendingReview");
  const [purpose, setPurpose] = useState("");
  const [message, setMessage] = useState<string>();
  const communications = useApi(useCallback(async () => api.customerCommunications(await token(), status, purpose || undefined, 200), [purpose, status, token]));

  async function review(item: CustomerCommunication, approve: boolean) {
    try {
      const note = approve ? "Reviewed communications evidence; approved for operational record." : "Rejected after communications review.";
      if (approve) await api.approveCustomerCommunication(item.id, note, await token());
      else await api.rejectCustomerCommunication(item.id, note, await token());
      setMessage(`${approve ? "Approved" : "Rejected"}: ${item.payload.source.subject || item.id}`);
      await communications.refresh();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Communication review failed."); }
  }

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Mailbox intelligence</p><h1>Customer communications</h1><p className="intro">Every ETA, load plan, amendment and exception is retained as source evidence, extracted into operational claims, and reviewed before it influences the TMS record.</p></div>
      <Link className="secondary" to="/exports">Open ETA proof →</Link>
    </div>
    <div className="planner-toolbar">
      <label>Status <select value={status} onChange={event => setStatus(event.target.value)}><option value="PendingReview">Pending review</option><option value="Promoted">Reviewed</option><option value="Rejected">Rejected</option><option value="">All</option></select></label>
      <label>Type <select value={purpose} onChange={event => setPurpose(event.target.value)}><option value="">All communications</option><option value="EtaUpdate">ETA updates</option><option value="LoadPlan">Load plans</option><option value="Exception">Exceptions</option></select></label>
      <button type="button" onClick={() => void communications.refresh()} disabled={communications.loading}>Refresh</button>
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {communications.error && <p className="notice inline-notice">Communications could not refresh: {communications.error}</p>}
    {communications.loading && <p className="hint">Loading communication evidence…</p>}
    {!communications.loading && communications.data?.length === 0 && <div className="panel"><h2>Nothing awaits review</h2><p className="hint">The ledger is clear for the selected filter.</p></div>}
    <div className="order-intake-grid">{communications.data?.map(item => {
      const source = item.payload.source; const extraction = item.payload.extraction;
      return <article className={`panel ${extraction.exceptionSignals.length ? "attention" : ""}`} key={item.id}>
        <div className="title-row"><div><p className="eyebrow">{purposeLabel[extraction.purpose] || extraction.purpose} · {extraction.planVersion}</p><h2>{source.subject || "Untitled communication"}</h2><p className="hint">{source.senderName || source.senderAddress || "Unknown sender"} · {new Date(item.receivedAtUtc).toLocaleString()}</p></div><strong>{item.status}</strong></div>
        {extraction.customerHints.length > 0 && <p><strong>Customer:</strong> {extraction.customerHints.join(", ")}</p>}
        {extraction.claims.map((claim, index) => <p key={`${item.id}-claim-${index}`}><strong>{claim.vehicleNumber ? `Vehicle ${claim.vehicleNumber}` : claim.loadReference ? `Load ${claim.loadReference}` : "ETA"}:</strong> {claim.etaFromLocal}{claim.etaToLocal ? `–${claim.etaToLocal}` : ""}{claim.pallets ? ` · ${claim.pallets} pallets` : ""} <small>({claim.evidence})</small></p>)}
        {extraction.exceptionSignals.length > 0 && <p className="notice inline-notice"><strong>Exception signals:</strong> {extraction.exceptionSignals.join(", ")}</p>}
        {extraction.nextUpdateLocal && <p><strong>Next update:</strong> {extraction.nextUpdateLocal}{extraction.acceptanceUntilLocal ? ` · acceptance until ${extraction.acceptanceUntilLocal}` : ""}</p>}
        {extraction.attachments.length > 0 && <p><strong>Attachments:</strong> {extraction.attachments.map(x => x.name).filter(Boolean).join(", ")}</p>}
        {extraction.warnings.length > 0 && <p className="notice inline-notice"><strong>Review warnings:</strong> {extraction.warnings.join(" · ")}</p>}
        {item.status === "PendingReview" && <div className="actions"><button className="primary" type="button" onClick={() => void review(item, true)}>Approve record</button><button type="button" onClick={() => void review(item, false)}>Reject</button></div>}
      </article>;
    })}</div>
  </section>;
}
