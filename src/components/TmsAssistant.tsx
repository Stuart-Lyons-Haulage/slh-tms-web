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
type SafeFixResult = { applied: number; skipped: number; changes?: string[]; skippedItems?: string[] };

export function TmsAssistant() {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>();
  const [efficiency, setEfficiency] = useState<EfficiencyResponse>();
  const [question, setQuestion] = useState("What needs attention before we dispatch?");
  const [answer, setAnswer] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const date = localDate();

  async function refresh() {
    setBusy(true); setMessage(undefined);
    try {
      const accessToken = await token();
      const [nextSnapshot, nextEfficiency] = await Promise.all([
        api.assistantSnapshot(date, accessToken),
        request<EfficiencyResponse>(`/api/v1/assistant/efficiency?date=${encodeURIComponent(date)}`, accessToken),
      ]);
      setSnapshot(nextSnapshot); setEfficiency(nextEfficiency);
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "Assistant checks could not load.");
    } finally { setBusy(false); }
  }
  async function toggle() { const next = !open; setOpen(next); if (next && !snapshot) await refresh(); }

  async function runSafeFixes() {
    const result = await api.fixSafeValidations(await token()) as SafeFixResult;
    const detail = (result.changes || []).slice(0, 8).join("\n");
    const skipped = (result.skippedItems || []).slice(0, 5).join("\n");
    setAnswer([
      result.applied ? `${result.applied} safe correction${result.applied === 1 ? "" : "s"} applied.` : "No deterministic correction was needed.",
      detail,
      result.skipped ? `${result.skipped} item${result.skipped === 1 ? "" : "s"} still require planner review.` : "",
      skipped,
    ].filter(Boolean).join("\n"));
    setMessage(result.applied ? "Corrections have been written to the TMS. The checks have been refreshed below." : "No safe automatic change was required.");
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
      if (/\b(fix|apply|correct|resolve)\b/i.test(question) && /\b(safe|validation|duplicate|map|registration)\b/i.test(question)) await runSafeFixes();
      else setMessage("Advice returned. Use a Fix safely button for deterministic corrections; allocation and compliance overrides still require a planner decision.");
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "The assistant could not answer just now."); }
    finally { setBusy(false); }
  }

  async function applyFixes() {
    setBusy(true); setMessage(undefined);
    try { await runSafeFixes(); }
    catch (exception) { setMessage(exception instanceof Error ? exception.message : "Safe fixes could not be applied."); }
    finally { setBusy(false); }
  }

  const fixable = snapshot?.suggestions.filter(item => item.autoFixAvailable).length || 0;
  return <div className={`tms-assistant ${open ? "open" : ""}`}>
    <button className="assistant-launch" type="button" onClick={() => void toggle()} aria-expanded={open}>
      <span>✦</span><strong>SLH Assistant</strong>
      {(snapshot?.suggestions.some(item => item.severity === "high") || (efficiency?.suggestedContinuations || 0) > 0) && <i />}
    </button>
    {open && <aside className="assistant-panel" aria-label="SLH planning assistant">
      <div className="assistant-heading"><div><p className="eyebrow">Smart operations</p><h2>SLH Assistant</h2></div><button type="button" aria-label="Close assistant" onClick={() => setOpen(false)}>×</button></div>
      <p className="assistant-source">{snapshot?.source || "Loading safety rules…"} · {snapshot?.aiConfigured ? "AI connected" : "AI key setup pending"}</p>
      {snapshot && <div className="assistant-metrics">
        <span><b>{snapshot.metrics.unplannedOrders}</b> unplanned</span>
        <span><b>{snapshot.metrics.unallocatedLoads}</b> unallocated</span>
        <span><b>{snapshot.metrics.vehicleComplianceRisks}</b> fleet risks</span>
        <span><b>{snapshot.metrics.missingSiteMapPoints}</b> map points</span>
        <span><b>{snapshot.metrics.duplicateSiteGroups}</b> duplicate sites</span>
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
        {snapshot?.suggestions.slice(0, 8).map(item => <article className={item.severity} key={item.id}>
          <span>{item.area}</span><strong>{item.title}</strong><p>{item.detail}</p>
          <div className="assistant-card-actions">
            <button type="button" onClick={() => { const routes: Record<string,string> = { Sites:"/sites", Drivers:"/drivers", Vehicles:"/fleet-assets", Reporting:"/reporting", Planner:"/", Customers:"/customers" }; window.location.assign(routes[item.area] || "/master-data"); }}>Open {item.area}</button>
            {item.autoFixAvailable && <button type="button" className="primary" disabled={busy} onClick={() => void applyFixes()}>Fix safely</button>}
          </div>
        </article>)}
      </div>
      {answer && <div className="assistant-answer"><strong>Result</strong><p style={{ whiteSpace: "pre-line" }}>{answer}</p></div>}
      <form onSubmit={event => void ask(event)}>
        <label htmlFor="assistant-question">Ask about today’s plan</label>
        <textarea id="assistant-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} />
        <div className="assistant-actions"><button className="primary" disabled={busy}>{busy ? "Checking…" : "Ask assistant"}</button><button type="button" onClick={() => void refresh()} disabled={busy}>Refresh checks</button></div>
      </form>
      {fixable > 0 && <button type="button" className="assistant-fix" onClick={() => void applyFixes()} disabled={busy}>Fix {fixable} safe validation area{fixable === 1 ? "" : "s"}</button>}
      {message && <p className="notice inline-notice">{message}</p>}
      <small>Safe fixes can repair map links, geocoding, exact duplicate sites, normalised registrations and customer email formatting. Driver identity, dispatch, legal-hours overrides and ambiguous merges remain planner-controlled.</small>
    </aside>}
  </div>;
}