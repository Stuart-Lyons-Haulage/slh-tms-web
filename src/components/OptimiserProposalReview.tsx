import { useMemo, useState, useCallback } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange } from "../lib/planningEvents";

// ── Types ─────────────────────────────────────────────────────────────────────

type StopDto = {
  siteId?: string;
  siteName: string;
  sequence: number;
  stopType: string;
  plannedArrival?: string;
  accessWindowOpen?: string;
  accessWindowClose?: string;
  lastDespatch?: string;
  isUnrestricted: boolean;
};

type ScoreComponent = { code: string; value: number; explanation: string };

type SuggestionDto = {
  suggestionId: string;
  kind: string;
  status: string;
  constraintClass: string;
  title: string;
  rationale: string;
  sourceRunReference?: string;
  targetRunReference?: string;
  orderReference?: string;
  currentMiles?: number;
  proposedMiles?: number;
  currentDriveMinutes?: number;
  proposedDriveMinutes?: number;
  beforeStops: StopDto[];
  afterStops: StopDto[];
  confidenceScore: number;
  benefitScore: number;
  routingSource?: string;
  cannotApplyReason?: string;
  scoreComponents: ScoreComponent[];
  decisionReason?: string;
  sequence: number;
};

type AnalysisDto = {
  analysisId: string;
  planningDate: string;
  period: string;
  correlationId: string;
  optimiserVersion: string;
  scoringConfigVersion?: string;
  status: string;
  overallResult: string;
  currentRunCount: number;
  currentTotalMiles: number;
  currentTotalDriveMinutes: number;
  proposedRunCount: number;
  proposedTotalMiles: number;
  proposedTotalDriveMinutes: number;
  runsAffected: number;
  analysedAtUtc: string;
  improvements: SuggestionDto[];
  warnings: SuggestionDto[];
  hardFailures: SuggestionDto[];
  unchanged: SuggestionDto[];
  manualReviewRequired: SuggestionDto[];
  accepted: SuggestionDto[];
  rejected: SuggestionDto[];
  affectedRuns: unknown[];
};

type ApplyResult = {
  analysisId: string;
  status: string;
  suggestionsApplied: number;
  runsModified: number;
  warnings: string[];
  failures: string[];
};

type DecisionResult = {
  suggestionId: string;
  newStatus: string;
  message: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REJECT_REASONS = [
  { code: "PlannerJudgement",       label: "Planner judgement" },
  { code: "CustomerInstructions",   label: "Customer instructions" },
  { code: "SiteRestriction",        label: "Site restriction" },
  { code: "TrailerRestriction",     label: "Trailer restriction" },
  { code: "DriverPreference",       label: "Driver preference" },
  { code: "OperationalPracticality",label: "Operational practicality" },
  { code: "TimingConflict",         label: "Timing conflict" },
  { code: "InsufficientConfidence", label: "Insufficient confidence" },
  { code: "DataQuality",            label: "Data quality" },
  { code: "Other",                  label: "Other" },
];

const STATUS_COLOURS: Record<string, string> = {
  Ready:                  "#2f6f44",
  PartiallyAccepted:      "#9a6700",
  Applied:                "#2f6f44",
  Rejected:               "#c0392b",
  SupersededByPlanChange: "#c0392b",
  Pending:                "#555",
};

const CONSTRAINT_COLOURS: Record<string, string> = {
  Hard:    "#c0392b",
  Soft:    "#2f6f44",
  Warning: "#9a6700",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(minutes?: number) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function milesDiff(current?: number, proposed?: number) {
  if (current == null || proposed == null) return null;
  return current - proposed;
}

function confidenceColour(score: number) {
  if (score >= 75) return "#2f6f44";
  if (score >= 50) return "#9a6700";
  return "#c0392b";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="panel" style={{ padding: "8px 12px" }}>
      <small style={{ display: "block", color: "#666" }}>{label}</small>
      <strong style={{ fontSize: 18 }}>{value}</strong>
      {sub && <small style={{ display: "block", color: "#888" }}>{sub}</small>}
    </div>
  );
}

function StopSequence({ stops, label }: { stops: StopDto[]; label: string }) {
  if (!stops.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <small style={{ color: "#666", fontWeight: 600 }}>{label}</small>
      <ol style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
        {stops.map((s, i) => (
          <li key={i} style={{ fontSize: 12, color: s.stopType === "Delivery" ? "#2f6f44" : "#9a6700" }}>
            {s.siteName}
            {s.plannedArrival && <span style={{ color: "#888" }}> · {new Date(s.plannedArrival).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
            {!s.isUnrestricted && s.accessWindowOpen && <span style={{ color: "#c0392b" }}> [{s.accessWindowOpen}–{s.accessWindowClose}]</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  showBeforeAfter,
  onAccept,
  onReject,
  busy,
}: {
  suggestion: SuggestionDto;
  showBeforeAfter: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string, code: string, text: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCode, setRejectCode] = useState("PlannerJudgement");
  const [rejectText, setRejectText] = useState("");

  const saved = milesDiff(suggestion.currentMiles, suggestion.proposedMiles);
  const isHard = suggestion.constraintClass === "Hard";
  const isPending = suggestion.status === "Pending";
  const isAccepted = suggestion.status === "Accepted" || suggestion.status === "Applied";
  const isRejected = suggestion.status === "Rejected";
  const cannotApply = suggestion.status === "CannotApply";

  const borderColour = isHard ? "#c0392b" : isAccepted ? "#2f6f44" : isRejected ? "#888" : CONSTRAINT_COLOURS[suggestion.constraintClass] ?? "#c8d7df";

  function submitReject() {
    onReject(suggestion.suggestionId, rejectCode, rejectText);
    setRejectOpen(false);
    setRejectText("");
  }

  return (
    <article
      style={{
        border: `1px solid ${borderColour}`,
        borderLeft: `4px solid ${borderColour}`,
        borderRadius: 8,
        padding: "10px 12px",
        opacity: isRejected ? 0.6 : 1,
        background: isAccepted ? "#f0faf4" : isRejected ? "#fafafa" : "#fff",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: CONSTRAINT_COLOURS[suggestion.constraintClass] ?? "#888",
                color: "#fff",
              }}
            >
              {suggestion.constraintClass}
            </span>
            <span style={{ fontSize: 11, color: "#666" }}>{suggestion.kind.replace(/([A-Z])/g, " $1").trim()}</span>
            {suggestion.routingSource && (
              <span style={{ fontSize: 11, color: "#888" }}>· {suggestion.routingSource}</span>
            )}
          </div>
          <strong style={{ fontSize: 14 }}>{suggestion.title}</strong>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "#555" }}>{suggestion.rationale}</p>
        </div>

        {/* Metrics */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
          {saved != null && (
            <div style={{ textAlign: "center" }}>
              <strong style={{ color: saved > 0 ? "#2f6f44" : "#c0392b", fontSize: 15 }}>
                {saved > 0 ? `−${saved.toFixed(1)}` : `+${Math.abs(saved).toFixed(1)}`} mi
              </strong>
              <br />
              <small style={{ color: "#888" }}>road miles</small>
            </div>
          )}
          <div style={{ textAlign: "center" }}>
            <strong style={{ color: confidenceColour(suggestion.confidenceScore), fontSize: 15 }}>
              {suggestion.confidenceScore.toFixed(0)}%
            </strong>
            <br />
            <small style={{ color: "#888" }}>confidence</small>
          </div>

          {/* Status badge */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 12,
              background: isAccepted ? "#2f6f44" : isRejected ? "#888" : isPending ? "#e8f4fd" : "#fde8e8",
              color: isAccepted || isRejected ? "#fff" : isPending ? "#1a4a7a" : "#7a1a1a",
            }}
          >
            {suggestion.status}
          </span>
        </div>
      </div>

      {/* Drive time comparison */}
      {suggestion.currentDriveMinutes != null && suggestion.proposedDriveMinutes != null && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
          Drive time: <strong>{fmt(suggestion.currentDriveMinutes)}</strong> → <strong style={{ color: "#2f6f44" }}>{fmt(suggestion.proposedDriveMinutes)}</strong>
          {" "}({fmt(suggestion.currentDriveMinutes - suggestion.proposedDriveMinutes)} saved)
        </div>
      )}

      {/* Cannot apply reason */}
      {cannotApply && suggestion.cannotApplyReason && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#c0392b", fontWeight: 600 }}>
          ⛔ {suggestion.cannotApplyReason}
        </p>
      )}

      {/* Expand/collapse */}
      {showBeforeAfter && (suggestion.beforeStops.length > 0 || suggestion.afterStops.length > 0 || suggestion.scoreComponents.length > 0) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 8, fontSize: 12, background: "none", border: "none", color: "#2f6f44", cursor: "pointer", padding: 0 }}
        >
          {expanded ? "▲ Hide detail" : "▼ Show before/after"}
        </button>
      )}

      {expanded && (
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "1px solid #eee", paddingTop: 8 }}>
          <StopSequence stops={suggestion.beforeStops} label="Current sequence" />
          <StopSequence stops={suggestion.afterStops} label="Proposed sequence" />
          {suggestion.scoreComponents.length > 0 && (
            <div style={{ gridColumn: "1/-1" }}>
              <small style={{ fontWeight: 600, color: "#666" }}>Score factors</small>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {suggestion.scoreComponents.map((c) => (
                  <span
                    key={c.code}
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: c.value > 0 ? "#e8f5ee" : "#fdecea",
                      color: c.value > 0 ? "#2f6f44" : "#c0392b",
                    }}
                    title={c.explanation}
                  >
                    {c.code}: {c.value > 0 ? "+" : ""}{c.value.toFixed(1)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision buttons */}
      {isPending && !cannotApply && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onAccept(suggestion.suggestionId)}
            style={{ fontSize: 13 }}
          >
            ✓ Accept
          </button>
          {!rejectOpen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
              style={{ fontSize: 13 }}
            >
              ✗ Reject
            </button>
          )}
          {rejectOpen && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={rejectCode}
                onChange={(e) => setRejectCode(e.target.value)}
                style={{ fontSize: 12 }}
                disabled={busy}
              >
                {REJECT_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Optional note…"
                value={rejectText}
                onChange={(e) => setRejectText(e.target.value)}
                style={{ fontSize: 12, width: 180 }}
                disabled={busy}
              />
              <button type="button" disabled={busy} onClick={submitReject} style={{ fontSize: 12 }}>
                Confirm reject
              </button>
              <button type="button" onClick={() => setRejectOpen(false)} style={{ fontSize: 12 }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {isRejected && suggestion.decisionReason && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#888" }}>
          Rejected: {suggestion.decisionReason}
        </p>
      )}
    </article>
  );
}

// ── Section component ─────────────────────────────────────────────────────────

function SuggestionSection({
  title,
  colour,
  suggestions,
  onAccept,
  onReject,
  busy,
  showBeforeAfter,
  defaultOpen,
}: {
  title: string;
  colour: string;
  suggestions: SuggestionDto[];
  onAccept: (id: string) => void;
  onReject: (id: string, code: string, text: string) => void;
  busy: boolean;
  showBeforeAfter: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  if (!suggestions.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          marginBottom: 6,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: colour, display: "inline-block" }} />
        <strong style={{ fontSize: 14, color: "#333" }}>
          {title} ({suggestions.length})
        </strong>
        <span style={{ fontSize: 12, color: "#888" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ display: "grid", gap: 8 }}>
          {suggestions.map((s) => (
            <SuggestionRow
              key={s.suggestionId}
              suggestion={s}
              showBeforeAfter={showBeforeAfter}
              onAccept={onAccept}
              onReject={onReject}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OptimiserProposalReview({
  planningDate,
  onApplied,
}: {
  planningDate: string;
  onApplied?: () => void | Promise<void>;
}) {
  const token = useAccessToken();
  const [period, setPeriod] = useState<"AM" | "PM">("AM");
  const [analysis, setAnalysis] = useState<AnalysisDto>();
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [message, setMessage] = useState<{ text: string; type: "info" | "error" | "success" }>();
  const [showBeforeAfter, setShowBeforeAfter] = useState(true);
  const [confirmApply, setConfirmApply] = useState(false);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);

  // Pending count for action bar
  const pendingCount = useMemo(
    () =>
      [
        ...(analysis?.improvements ?? []),
        ...(analysis?.warnings ?? []),
      ].filter((s) => s.status === "Pending").length,
    [analysis]
  );

  const acceptedCount = useMemo(
    () => (analysis?.accepted ?? []).length,
    [analysis]
  );

  const hasHardFailures = (analysis?.hardFailures ?? []).length > 0;
  const canApply =
    analysis?.status !== "Applied" &&
    analysis?.status !== "Rejected" &&
    acceptedCount > 0 &&
    !busy;

  // ── API calls ──────────────────────────────────────────────────────────────

  async function analyse() {
    setBusy(true);
    setMessage(undefined);
    setConfirmApply(false);
    setAcknowledgeWarnings(false);
    try {
      const result = await request<AnalysisDto>(
        "/api/v1/optimisation/analyse",
        await token(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planningDate, period }),
        },
        180000
      );
      setAnalysis(result);
      const total =
        result.improvements.length + result.warnings.length + result.hardFailures.length;
      setMessage({
        text: total === 0
          ? "Analysis complete — current plan is already optimal."
          : `Analysis complete. ${total} suggestion${total === 1 ? "" : "s"} found across ${result.runsAffected} run${result.runsAffected === 1 ? "" : "s"}.`,
        type: "info",
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Analysis failed.", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  const acceptSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!analysis) return;
      setBusyId(suggestionId);
      try {
        await request<DecisionResult>(
          "/api/v1/optimisation/suggestions/accept",
          await token(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suggestionId }),
          }
        );
        // Refresh full analysis
        const updated = await request<AnalysisDto>(
          `/api/v1/optimisation/${analysis.analysisId}`,
          await token()
        );
        setAnalysis(updated);
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Could not accept suggestion.", type: "error" });
      } finally {
        setBusyId(undefined);
      }
    },
    [analysis, token]
  );

  const rejectSuggestion = useCallback(
    async (suggestionId: string, code: string, freeText: string) => {
      if (!analysis) return;
      setBusyId(suggestionId);
      try {
        await request<DecisionResult>(
          "/api/v1/optimisation/suggestions/reject",
          await token(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suggestionId, rejectCode: code, freeText }),
          }
        );
        const updated = await request<AnalysisDto>(
          `/api/v1/optimisation/${analysis.analysisId}`,
          await token()
        );
        setAnalysis(updated);
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Could not reject suggestion.", type: "error" });
      } finally {
        setBusyId(undefined);
      }
    },
    [analysis, token]
  );

  async function acceptAll() {
    if (!analysis) return;
    setBusy(true);
    try {
      await request(
        "/api/v1/optimisation/accept-all",
        await token(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysisId: analysis.analysisId, acknowledgeWarnings }),
        }
      );
      const updated = await request<AnalysisDto>(
        `/api/v1/optimisation/${analysis.analysisId}`,
        await token()
      );
      setAnalysis(updated);
      setMessage({ text: "All valid suggestions accepted. Review then apply.", type: "info" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Accept all failed.", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function rejectAll() {
    if (!analysis) return;
    setBusy(true);
    try {
      await request(
        "/api/v1/optimisation/reject",
        await token(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysisId: analysis.analysisId, rejectCode: "PlannerJudgement" }),
        }
      );
      setAnalysis((a) => a ? { ...a, status: "Rejected" } : a);
      setMessage({ text: "Analysis rejected. No changes applied.", type: "info" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Reject failed.", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function applyAccepted() {
    if (!analysis || !confirmApply) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await request<ApplyResult>(
        "/api/v1/optimisation/apply",
        await token(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysisId: analysis.analysisId,
            acknowledgeWarnings,
          }),
        },
        180000
      );
      setAnalysis((a) => a ? { ...a, status: result.status } : a);
      setConfirmApply(false);
      signalPlanningChange();
      await onApplied?.();
      const failStr = result.failures.length ? ` ${result.failures.length} suggestion(s) failed to apply.` : "";
      setMessage({
        text: `${result.suggestionsApplied} suggestion${result.suggestionsApplied === 1 ? "" : "s"} applied to ${result.runsModified} run${result.runsModified === 1 ? "" : "s"}.${failStr}`,
        type: result.failures.length ? "error" : "success",
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Apply failed.", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const statusColour = analysis ? (STATUS_COLOURS[analysis.status] ?? "#555") : "#555";

  return (
    <section
      className="panel"
      style={{ marginBottom: 16, border: "1px solid #c8d7df", borderRadius: 12, padding: 14, background: "#f8fbfc" }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 3 }}>Route optimiser</p>
          <h2 style={{ margin: 0 }}>Analyse and improve planned runs</h2>
          <small>Analysis is read-only. No run changes until you accept suggestions and click Apply.</small>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(["AM", "PM"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={period === v ? "primary" : ""}
              onClick={() => setPeriod(v)}
              disabled={busy}
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            className="primary"
            onClick={() => void analyse()}
            disabled={busy || !planningDate}
          >
            {busy && !busyId ? "Analysing…" : "Analyse runs"}
          </button>
        </div>
      </div>

      {/* Message bar */}
      {message && (
        <p
          className="notice inline-notice"
          style={{
            marginTop: 10,
            borderLeft: `4px solid ${message.type === "error" ? "#c0392b" : message.type === "success" ? "#2f6f44" : "#9a6700"}`,
          }}
        >
          {message.text}
        </p>
      )}

      {analysis && (
        <>
          {/* Summary metrics */}
          <div
            style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}
          >
            <MetricCard label="Status" value={analysis.status} />
            <MetricCard
              label="Mileage"
              value={`${analysis.currentTotalMiles.toFixed(1)} → ${analysis.proposedTotalMiles.toFixed(1)} mi`}
              sub={`Save ${(analysis.currentTotalMiles - analysis.proposedTotalMiles).toFixed(1)} mi`}
            />
            <MetricCard
              label="Drive time"
              value={`${fmt(analysis.currentTotalDriveMinutes)} → ${fmt(analysis.proposedTotalDriveMinutes)}`}
              sub={`Save ${fmt(analysis.currentTotalDriveMinutes - analysis.proposedTotalDriveMinutes)}`}
            />
            <MetricCard label="Runs affected" value={analysis.runsAffected} />
            <MetricCard label="Optimiser" value={analysis.optimiserVersion} sub={analysis.scoringConfigVersion ?? ""} />
            <MetricCard label="Analysed" value={new Date(analysis.analysedAtUtc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} />
          </div>

          {/* Overall result */}
          <p
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 6,
              background: "#fff",
              border: `1px solid ${statusColour}`,
              color: statusColour,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {analysis.overallResult}
          </p>

          {/* Before/after toggle */}
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showBeforeAfter}
              onChange={(e) => setShowBeforeAfter(e.target.checked)}
            />
            Show before/after stop sequences
          </label>

          {/* Hard failures */}
          <SuggestionSection
            title="Hard constraint failures"
            colour="#c0392b"
            suggestions={analysis.hardFailures}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busy={!!busy || !!busyId}
            showBeforeAfter={showBeforeAfter}
            defaultOpen
          />

          {/* Improvements */}
          <SuggestionSection
            title="Recommended improvements"
            colour="#2f6f44"
            suggestions={analysis.improvements}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busy={!!busy || !!busyId}
            showBeforeAfter={showBeforeAfter}
            defaultOpen
          />

          {/* Warnings */}
          <SuggestionSection
            title="Warnings"
            colour="#9a6700"
            suggestions={analysis.warnings}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busy={!!busy || !!busyId}
            showBeforeAfter={showBeforeAfter}
            defaultOpen
          />

          {/* Manual review */}
          <SuggestionSection
            title="Requires manual review"
            colour="#888"
            suggestions={analysis.manualReviewRequired}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busy={!!busy || !!busyId}
            showBeforeAfter={showBeforeAfter}
          />

          {/* Accepted */}
          <SuggestionSection
            title="Accepted"
            colour="#2f6f44"
            suggestions={analysis.accepted}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busy={!!busy || !!busyId}
            showBeforeAfter={showBeforeAfter}
          />

          {/* Rejected */}
          <SuggestionSection
            title="Rejected"
            colour="#888"
            suggestions={analysis.rejected}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busy={!!busy || !!busyId}
            showBeforeAfter={showBeforeAfter}
            defaultOpen={false}
          />

          {/* Action bar */}
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid #c8d7df",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {pendingCount > 0 && analysis.status !== "Applied" && (
              <button type="button" onClick={() => void acceptAll()} disabled={!!busy || !!busyId}>
                Accept all ({pendingCount})
              </button>
            )}

            {analysis.status !== "Applied" && analysis.status !== "Rejected" && (
              <button
                type="button"
                onClick={() => void rejectAll()}
                disabled={!!busy || !!busyId}
                style={{ color: "#c0392b" }}
              >
                Reject all
              </button>
            )}

            {canApply && !confirmApply && (
              <button
                type="button"
                className="primary"
                onClick={() => setConfirmApply(true)}
                disabled={!!busy}
              >
                Apply {acceptedCount} accepted suggestion{acceptedCount === 1 ? "" : "s"} →
              </button>
            )}

            {canApply && confirmApply && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "8px 12px",
                  background: "#fff3cd",
                  borderRadius: 6,
                  border: "1px solid #9a6700",
                }}
              >
                <strong style={{ fontSize: 13 }}>
                  This will modify {acceptedCount} suggestion{acceptedCount === 1 ? "" : "s"} on live runs. Continue?
                </strong>
                {hasHardFailures && (
                  <label style={{ display: "flex", gap: 6, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={acknowledgeWarnings}
                      onChange={(e) => setAcknowledgeWarnings(e.target.checked)}
                    />
                    I acknowledge warnings / hard failures
                  </label>
                )}
                <button type="button" className="primary" onClick={() => void applyAccepted()} disabled={!!busy}>
                  {busy ? "Applying…" : "Confirm apply"}
                </button>
                <button type="button" onClick={() => setConfirmApply(false)} disabled={!!busy}>
                  Cancel
                </button>
              </div>
            )}

            {analysis.status === "Applied" && (
              <span style={{ color: "#2f6f44", fontWeight: 600, fontSize: 13 }}>
                ✓ Applied to live runs
              </span>
            )}
            {analysis.status === "Rejected" && (
              <span style={{ color: "#888", fontSize: 13 }}>Analysis rejected — no changes applied.</span>
            )}
            {analysis.status === "SupersededByPlanChange" && (
              <span style={{ color: "#c0392b", fontSize: 13 }}>
                ⚠ Plan changed since analysis — re-analyse before applying.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
