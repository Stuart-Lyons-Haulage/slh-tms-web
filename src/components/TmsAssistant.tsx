import { useState, type FormEvent } from "react";
import { api, request, type AssistantSnapshot } from "../lib/api";
import { useAccessToken } from "../lib/auth";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type EfficiencySuggestion = {
  driverId: string; driverName: string; previousRun: string; previousEnd: string;
  orderId: string; orderReference: string; collection: string; destination: string;
  estimatedRepositionMiles?: number; reason: string;
};
type EfficiencyResponse = {
  planningDate: string; previousDate: string; previousDayAllocatedDrivers: number; unplannedOrders: number;
  suggestedContinuations: number; suggestions: EfficiencySuggestion[]; message: string;
};
type SafeFixResult = { applied: number; skipped: number; changes?: string[]; skippedReasons?: string[] };
type DuplicateOrderStatus = {
  duplicateGroups: number; duplicateRecords: number; safeToRemove: number; requiresReview: number; message: string;
  examples?: Array<{ reference: string; customer: string; collectionDate: string; records: number; safeToRemove: number; requiresReview: number }>;
};

export function TmsAssistant() {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>();
  const [efficiency, setEfficiency] = useState<EfficiencyResponse>();
  const [duplicates, setDuplicates] = useState<DuplicateOrderStatus>();
  const [question, setQuestion] = useState("What needs attention before we dispatch?");
  const [answer, setAnswer] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const date = localDate();

  async function refresh() {
    setBusy(true); setMessage(undefined);
    try {
      const accessToken = await token();
      const [snapshotResult, efficiencyResult, duplicateResult] = await Promise.allSettled([
        api.assistantSnapshot(date, accessToken),
        request<EfficiencyResponse>(`/api/v1/assistant/efficiency?date=${encodeURIComponent(date)}`, accessToken),
        request<DuplicateOrderStatus>(`/api/v1/assistant/order-duplicates?date=${encodeURIComponent(date)}`, accessToken),
      ]);

      const warnings: string[] = [];
      if (snapshotResult.status === "fulfilled") setSnapshot(snapshotResult.value);
      else warnings.push(`Core checks: ${snapshotResult.reason instanceof Error ? snapshotResult.reason.message : "unavailable"}`);

      if (efficiencyResult.status === "fulfilled") setEfficiency(efficiencyResult.value);
      else { setEfficiency(undefined); warnings.push("Previous-day continuity check unavailable"); }

      if (duplicateResult.status === "fulfilled") setDuplicates(duplicateResult.value);
      else { setDuplicates(undefined); warnings.push("Duplicate-order check unavailable"); }

      if (warnings.length) {
        setMessage(snapshotResult.status === "fulfilled"
          ? `SLH Assistant is available. ${warnings.join(" · ")}. The available checks are shown below.`
          : `SLH Assistant could not load its core snapshot. ${warnings.join(" · ")}.`);
      }
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "Assistant checks could not load.");
    } finally { setBusy(false); }
  }
  async function toggle() { const next = !open; setOpen(next); if (next && !snapshot) await refresh(); }

  async function runSafeFixes() {
    const accessToken = await token();
    let masterResult: SafeFixResult = { applied: 0, skipped: 0 };
    let masterError = "";
    try {
      masterResult = await api.fixSafeValidations(accessToken) as SafeFixResult;
    } catch (exception) {
      masterError = exception instanceof Error ? exception.message : "Master-data repair could not run.";
    }

    let duplicateResult: SafeFixResult = { applied: 0, skipped: 0 };
    let duplicateError = "";
    try {
      duplicateResult = await request<SafeFixResult>(`/api/v1/assistant/order-duplicates/fix?date=${encodeURIComponent(date)}`, accessToken, { method: "POST" });
    } catch (exception) {
      duplicateError = exception instanceof Error ? exception.message : "Duplicate-order repair could not run.";
    }

    const result: SafeFixResult = {
      applied: masterResult.applied + duplicateResult.applied,
      skipped: masterResult.skipped + duplicateResult.skipped + (masterError ? 1 : 0) + (duplicateError ? 1 : 0),
      changes: [...(masterResult.changes || []), ...(duplicateResult.changes || [])],
      skippedReasons: [
        ...(masterResult.skippedReasons || []),
        ...(duplicateResult.skippedReasons || []),
        ...(masterError ? [`Master data: ${masterError}`] : []),
        ...(duplicateError ? [`Duplicate orders: ${duplicateError}`] : []),
      ],
    };
    const detail = (result.changes || []).slice(0, 16).join("\n");
    const skipped = (result.skippedReasons || []).slice(0, 10).join("\n");
    setAnswer([
      result.applied ? `${result.applied} safe correction${result.applied === 1 ? "" : "s"} applied to the live TMS.` : "No deterministic correction was applied.",
      detail,
      result.skipped ? `${result.skipped} item${result.skipped === 1 ? "" : "s"} left for review or temporarily unavailable.` : "",
      skipped,
    ].filter(Boolean).join("\n"));
    setMessage(result.applied ? "Corrections were written to the TMS and the available validation checks have been refreshed." : "No safe automatic change was applied. Any remaining items stay visible for review.");
    await refresh();
    return result;
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault(); if (!question.trim()) return;
    setBusy(true); setMessage(undefined);
    try {
      const response = await api.assistantAdvice(question, date, await token());
      setAnswer(response.answer);
      setSnapshot(current => current ? { ...current, source: response.source, suggestions: response.suggestions } : current);
      if (/\b(fix|apply|correct|resolve|clean|merge|repair|remove)\b/i.test(question) && /\b(safe|validation|duplicate|map|registration|site|market|master data|order|job)\b/i.test(question)) await runSafeFixes();
      else setMessage("Advice returned. Use Fix safely for deterministic corrections; planning, legal-hours and dispatch decisions remain planner-controlled.");
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "The assistant could not answer just now."); }
    finally { setBusy(false); }
  }

  async function applyFixes() {
    setBusy(true); setMessage(undefined);
    try { await runSafeFixes(); }
    catch (exception) { setMessage(exception instanceof Error ? exception.message : "Safe fixes could not be applied."); }
    finally { setBusy(false); }
  }

  const fixable = (snapshot?.suggestions.filter(item => item.autoFixAvailable).length || 0) + ((duplicates?.safeToRemove || 0) > 0 ? 1 : 0);
  return <div className={`tms-assistant ${open ? "open" : ""}`}>
    <button className="assistant-launch" type="button" onClick={() => void toggle()} aria-expanded={open}>
      <span>✦</span><strong>SLH Assistant</strong>
      {(snapshot?.suggestions.some(item => item.severity === "high") || (efficiency?.suggestedContinuations || 0) > 0 || (duplicates?.duplicateRecords || 0) > 0) && <i />}
    </button>
    {open && <aside className="assistant-panel" aria-label="SLH planning assistant">
      <div className="assistant-heading"><div><p className="eyebrow">Smart operations</p><h2>SLH Assistant</h2></div><button type="button" aria-label="Close assistant" onClick={() => setOpen(false)}>×</button></div>
      <p className="assistant-source">{snapshot?.source || "Loading safety rules…"} · {snapshot?.aiConfigured ? "AI connected" : "AI key setup pending"}</p>
      {snapshot && <div className="assistant-metrics">
        <span><b>{snapshot.metrics.unplannedOrders}</b> unplanned</span>
        <span><b>{snapshot.metrics.unallocatedLoads}</b> unallocated</span>
        <span><b>{duplicates?.duplicateRecords || 0}</b> duplicate orders</span>
        <span><b>{snapshot.metrics.vehicleComplianceRisks}</b> fleet risks</span>
        <span><b>{snapshot.metrics.missingSiteMapPoints}</b> map points</span>
        <span><b>{snapshot.metrics.duplicateSiteGroups}</b> duplicate sites</span>
      </div>}
      {duplicates && duplicates.duplicateRecords > 0 && <div className="assistant-suggestions">
        <article className="high">
          <span>Orders</span><strong>Resolve exact duplicate orders</strong><p>{duplicates.message}</p>
          <div className="assistant-card-actions"><button type="button" onClick={() => window.location.assign("/jobs")}>Open Manage Jobs</button>{duplicates.safeToRemove > 0 && <button type="button" className="primary" disabled={busy} onClick={() => void applyFixes()}>Remove {duplicates.safeToRemove} safe duplicate{duplicates.safeToRemove === 1 ? "" : "s"}</button>}</div>
        </article>
      </div>}
      {efficiency && <div className="assistant-suggestions">
        <article className="info"><span>Efficiency</span><strong>Previous-day continuity</strong><p>{efficiency.message}</p></article>
        {efficiency.suggestions.slice(0, 5).map(item => <article className="medium" key={`${item.driverId}-${item.orderId}`}>
          <span>Driver continuation</span><strong>{item.driverName}: {item.collection} → {item.destination}</strong>
          <p>Yesterday ended at {item.previousEnd}. {item.reason}</p>
          <div className="assistant-card-actions"><button type="button" onClick={() => window.location.assign("/")}>Open Planner</button></div>
        </article>)}
      </div>}
      <div className="assistant-suggestions">
        {snapshot?.suggestions.slice(0, 10).map(item => <article className={item.severity} key={item.id}>
          <span>{item.area}</span><strong>{item.title}</strong><p>{item.detail}</p>
          <div className="assistant-card-actions">
            <button type="button" onClick={() => { const routes: Record<string,string> = { Sites:"/sites", Drivers:"/drivers", Vehicles:"/fleet-assets", Reporting:"/reporting", Planner:"/", Customers:"/customers", Markets:"/markets", Orders:"/jobs" }; window.location.assign(routes[item.area] || "/master-data"); }}>Open {item.area}</button>
            {item.autoFixAvailable && <button type="button" className="primary" disabled={busy} onClick={() => void applyFixes()}>Fix safely</button>}
          </div>
        </article>)}
      </div>
      {answer && <div className="assistant-answer"><strong>What changed</strong><p style={{ whiteSpace: "pre-line" }}>{answer}</p></div>}
      <form onSubmit={event => void ask(event)}>
        <label htmlFor="assistant-question">Ask about today’s plan or master data</label>
        <textarea id="assistant-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} />
        <div className="assistant-actions"><button className="primary" disabled={busy}>{busy ? "Checking…" : "Ask assistant"}</button><button type="button" onClick={() => void refresh()} disabled={busy}>Refresh checks</button></div>
      </form>
      {fixable > 0 && <button type="button" className="assistant-fix" onClick={() => void applyFixes()} disabled={busy}>Fix {fixable} safe validation area{fixable === 1 ? "" : "s"}</button>}
      {message && <p className="notice inline-notice">{message}</p>}
      <small>Safe fixes can repair exact unallocated duplicate orders, map links, geocoding, proven duplicate sites, market naming, exact market duplicates, registrations and customer email formatting. Linked duplicate orders, ambiguous identities, dispatch decisions and legal-hours overrides remain planner-controlled.</small>
    </aside>}
  </div>;
}
