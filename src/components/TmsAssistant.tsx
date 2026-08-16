import { useState, type FormEvent } from "react";
import { api, type AssistantSnapshot } from "../lib/api";
import { useAccessToken } from "../lib/auth";

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function TmsAssistant() {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>();
  const [question, setQuestion] = useState(
    "What needs attention before we dispatch?",
  );
  const [answer, setAnswer] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const date = localDate();

  async function refresh() {
    setBusy(true);
    setMessage(undefined);
    try {
      setSnapshot(await api.assistantSnapshot(date, await token()));
    } catch (exception) {
      setMessage(
        exception instanceof Error
          ? exception.message
          : "Assistant checks could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !snapshot) await refresh();
  }
  async function ask(event?: FormEvent) {
    event?.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await api.assistantAdvice(question, date, await token());
      setAnswer(response.answer);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              source: response.source,
              suggestions: response.suggestions,
            }
          : current,
      );
      if (/\b(fix safe|apply safe|correct safe|resolve safe)\b/i.test(question)) {
        const result = await api.fixSafeValidations(await token());
        const actionMessage =
          result.applied
            ? `${result.applied} safe validation fix${result.applied === 1 ? "" : "es"} applied. ${result.skipped ? `${result.skipped} item${result.skipped === 1 ? "" : "s"} still need human review.` : ""}`
            : "The checks found no safe automatic change to make. Driver/TachoMaster identity matching needs confirmed master data and is never guessed.";
        await refresh();
        setMessage(actionMessage);
      } else {
        setMessage("Advice only—no records were changed. Ask “fix safe validations” to apply the available low-risk corrections.");
      }
    } catch (exception) {
      setMessage(
        exception instanceof Error
          ? exception.message
          : "The assistant could not answer just now.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function applyFixes() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.fixSafeValidations(await token());
      setMessage(
        result.applied
          ? `${result.applied} safe validation fix${result.applied === 1 ? "" : "es"} applied. ${result.skipped ? `${result.skipped} item${result.skipped === 1 ? "" : "s"} left for review.` : ""}`
          : "No safe automatic fix was needed.",
      );
      await refresh();
    } catch (exception) {
      setMessage(
        exception instanceof Error
          ? exception.message
          : "Safe fixes could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  }

  const fixable =
    snapshot?.suggestions.filter((item) => item.autoFixAvailable).length || 0;
  return (
    <div className={`tms-assistant ${open ? "open" : ""}`}>
      <button
        className="assistant-launch"
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
      >
        <span>✦</span>
        <strong>SLH Assistant</strong>
        {snapshot?.suggestions.some((item) => item.severity === "high") && (
          <i />
        )}
      </button>
      {open && (
        <aside className="assistant-panel" aria-label="SLH planning assistant">
          <div className="assistant-heading">
            <div>
              <p className="eyebrow">Smart operations</p>
              <h2>SLH Assistant</h2>
            </div>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <p className="assistant-source">
            {snapshot?.source || "Loading safety rules…"} ·{" "}
            {snapshot?.aiConfigured ? "AI connected" : "AI key setup pending"}
          </p>
          {snapshot && (
            <div className="assistant-metrics">
              <span>
                <b>{snapshot.metrics.unplannedOrders}</b> unplanned
              </span>
              <span>
                <b>{snapshot.metrics.unallocatedLoads}</b> unallocated
              </span>
              <span>
                <b>{snapshot.metrics.vehicleComplianceRisks}</b> fleet risks
              </span>
              <span>
                <b>{snapshot.metrics.unpricedLoads}</b> unpriced
              </span>
              <span>
                <b>{snapshot.metrics.negativeMarginLoads}</b> loss-making
              </span>
              <span>
                <b>{snapshot.metrics.missingSiteMapPoints}</b> map points
              </span>
              <span>
                <b>{snapshot.metrics.duplicateSiteGroups}</b> duplicate sites
              </span>
            </div>
          )}
          <div className="assistant-suggestions">
            {snapshot?.suggestions.slice(0, 5).map((item) => (
              <article className={item.severity} key={item.id}>
                <span>{item.area}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <div className="assistant-card-actions">
                  <button type="button" onClick={() => { const routes: Record<string, string> = { Sites: "/sites", Drivers: "/drivers", Vehicles: "/fleet-assets", Reporting: "/reporting", Planner: "/" }; window.location.assign(routes[item.area] || "/"); }}>
                    Open {item.area}
                  </button>
                  {item.autoFixAvailable && <button type="button" className="primary" disabled={busy} onClick={() => void applyFixes()}>Fix safely</button>}
                </div>
              </article>
            ))}
          </div>
          {answer && (
            <div className="assistant-answer">
              <strong>Suggestion</strong>
              <p>{answer}</p>
            </div>
          )}
          <form onSubmit={(event) => void ask(event)}>
            <label htmlFor="assistant-question">Ask about today’s plan</label>
            <textarea
              id="assistant-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={1000}
            />
            <div className="assistant-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Checking…" : "Ask assistant"}
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy}
              >
                Refresh checks
              </button>
            </div>
          </form>
          {fixable > 0 && (
            <button
              type="button"
              className="assistant-fix"
              onClick={() => void applyFixes()}
              disabled={busy}
            >
              Fix {fixable} safe validation area{fixable === 1 ? "" : "s"}
            </button>
          )}
          {message && <p className="notice inline-notice">{message}</p>}
          <small>
            Asking normally gives advice only. Ask “fix safe validations” or
            use the fix button to apply low-risk corrections. Driver identity,
            dispatch, allocation and compliance overrides always require a person.
          </small>
        </aside>
      )}
    </div>
  );
}
