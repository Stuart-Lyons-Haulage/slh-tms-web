import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { api, request, type StageBatchRequest, type StagedImport } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../order-review.css";

type IntakePayload = Record<string, unknown> & {
  poNumber?: string;
  customerPo?: string;
  customerCode?: string;
  collectionDate?: string;
  deliveryDate?: string;
  pallets?: number | string;
  sellerName?: string;
  marketName?: string;
  stallNumber?: string;
  requestedTime?: string;
  availableTime?: string;
  jobType?: string;
  driverInstructions?: string;
  sourceMessageId?: string;
  sourceInternetMessageId?: string;
  sourceSender?: string;
  sourceSenderName?: string;
  sourceSubject?: string;
  sourceReceivedAtUtc?: string;
  sourceWebLink?: string;
  sourceAttachmentName?: string;
  sourceSheet?: string;
  sourceRow?: number;
  intakeConfidence?: string;
  intakeWarnings?: string[];
};

type ReviewRow = { item: StagedImport; payload: IntakePayload; parseError?: string };
type ResetPreview = {
  date: string;
  loads: number;
  orders: number;
  staged: number;
  confirmation: string;
};
type ResetResult = ResetPreview & {
  cancelledLoads: number;
  cancelledOrders: number;
  removedStops: number;
  archivedStaged: number;
  warnings: string[];
  message: string;
};

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parsePayload(item: StagedImport): ReviewRow {
  try {
    const parsed = JSON.parse(item.payloadJson || "{}") as IntakePayload;
    return { item, payload: parsed && typeof parsed === "object" ? parsed : {} };
  } catch (error) {
    return {
      item,
      payload: {},
      parseError: error instanceof Error ? error.message : "Invalid staged JSON",
    };
  }
}

const text = (value: unknown) => String(value ?? "").trim();
const numberText = (value: unknown) => value == null || value === "" ? "" : String(value);
const warnings = (payload: IntakePayload) => Array.isArray(payload.intakeWarnings)
  ? payload.intakeWarnings.map(text).filter(Boolean)
  : [];

function formatDateTime(value: unknown) {
  const raw = text(value);
  if (!raw) return "—";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function confidence(payload: IntakePayload) {
  const value = text(payload.intakeConfidence) || (warnings(payload).length ? "Medium" : "High");
  return value.toLowerCase();
}

function displayPo(payload: IntakePayload) {
  return text(payload.customerPo) || text(payload.poNumber) || "Reference missing";
}

function setField(payload: IntakePayload, name: string, value: unknown): IntakePayload {
  return { ...payload, [name]: value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBatchFile(raw: unknown): StageBatchRequest[] {
  const candidate = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw.records)
      ? raw.records
      : undefined;

  if (!candidate) throw new Error("This is not a TMS order staging batch. Select the JSON batch created for Order Review.");
  if (candidate.length === 0) throw new Error("The selected batch contains no orders.");
  if (candidate.length > 500) throw new Error("A manual batch can contain a maximum of 500 orders.");

  return candidate.map((item, index) => {
    if (!isObject(item)) throw new Error(`Record ${index + 1} is not a valid object.`);
    if (text(item.entityType).toLowerCase() !== "order") throw new Error(`Record ${index + 1} is not an order staging record.`);
    if (!text(item.idempotencyKey)) throw new Error(`Record ${index + 1} is missing its idempotency key.`);
    if (!isObject(item.payload)) throw new Error(`Record ${index + 1} is missing its order payload.`);
    return item as unknown as StageBatchRequest;
  });
}

export function OrderReviewOperational() {
  const token = useAccessToken();
  const [dateFilter, setDateFilter] = useState(tomorrowDate());
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<IntakePayload>();
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [resetDate, setResetDate] = useState(tomorrowDate());
  const [resetPreview, setResetPreview] = useState<ResetPreview>();
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [importFileName, setImportFileName] = useState<string>();
  const [importRecords, setImportRecords] = useState<StageBatchRequest[]>([]);
  const [importError, setImportError] = useState<string>();
  const [importBusy, setImportBusy] = useState(false);

  const queue = useApi(useCallback(async () =>
    api.staging(await token(), "PendingReview", "order", 2000), [token]));

  const rows = useMemo(() => (queue.data || []).map(parsePayload), [queue.data]);
  const visibleRows = useMemo(() => rows
    .filter((row) => showAll || row.payload.collectionDate === dateFilter || row.payload.deliveryDate === dateFilter)
    .sort((left, right) => {
      const leftWarnings = warnings(left.payload).length;
      const rightWarnings = warnings(right.payload).length;
      const priority = (value: string) => value === "low" ? 0 : value === "medium" ? 1 : 2;
      return priority(confidence(left.payload)) - priority(confidence(right.payload))
        || rightWarnings - leftWarnings
        || text(left.payload.sourceReceivedAtUtc).localeCompare(text(right.payload.sourceReceivedAtUtc));
    }), [dateFilter, rows, showAll]);

  const cleanCount = rows.filter((row) => confidence(row.payload) === "high" && warnings(row.payload).length === 0).length;
  const attentionCount = rows.length - cleanCount;

  const importSummary = useMemo(() => {
    const keys = importRecords.map((record) => text(record.idempotencyKey));
    const duplicateKeys = keys.length - new Set(keys.map((key) => key.toLowerCase())).size;
    let missingPo = 0;
    let missingCustomer = 0;
    let missingDate = 0;
    let warningCount = 0;
    const dates = new Set<string>();

    for (const record of importRecords) {
      const payload = record.payload as unknown as Record<string, unknown>;
      if (!text(payload.poNumber)) missingPo++;
      if (!text(payload.customerCode)) missingCustomer++;
      const collectionDate = text(payload.collectionDate);
      if (!collectionDate) missingDate++;
      else dates.add(collectionDate);
      if (Array.isArray(payload.intakeWarnings)) warningCount += payload.intakeWarnings.length;
    }

    const needsCorrection = importRecords.filter((record) => {
      const payload = record.payload as unknown as Record<string, unknown>;
      return !text(payload.poNumber) || !text(payload.customerCode) || !text(payload.collectionDate);
    }).length;

    return {
      total: importRecords.length,
      duplicateKeys,
      missingPo,
      missingCustomer,
      missingDate,
      warningCount,
      needsCorrection,
      dates: [...dates].sort(),
    };
  }, [importRecords]);

  async function review(row: ReviewRow, approved: boolean) {
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      await api.review(
        row.item.id,
        approved,
        approved ? "Accepted from Info mailbox order review." : "Rejected from Info mailbox order review.",
        await token(),
      );
      if (editingId === row.item.id) {
        setEditingId(undefined);
        setDraft(undefined);
      }
      await queue.refresh();
      setNotice(approved
        ? `${displayPo(row.payload)} accepted and promoted to Orders.`
        : `${displayPo(row.payload)} rejected. Source evidence remains in the audit history.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The review action failed.");
    } finally {
      setBusyId(undefined);
    }
  }

  function beginEdit(row: ReviewRow) {
    setEditingId(row.item.id);
    setDraft({ ...row.payload });
    setNotice(undefined);
  }

  async function saveEdit(row: ReviewRow) {
    if (!draft) return;
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      const next: IntakePayload = {
        ...row.payload,
        ...draft,
        pallets: numberText(draft.pallets) === "" ? undefined : Number(draft.pallets),
      };
      await request<StagedImport>(`/api/v1/staging/${row.item.id}/payload`, await token(), {
        method: "PUT",
        body: JSON.stringify({
          payload: next,
          note: "Corrected in Order review before approval.",
        }),
      });
      setEditingId(undefined);
      setDraft(undefined);
      await queue.refresh();
      setNotice(`${displayPo(next)} saved. It is still waiting for acceptance.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The staged order could not be saved.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function selectImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportFileName(file.name);
    setImportRecords([]);
    setImportError(undefined);
    setNotice(undefined);
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const records = parseBatchFile(raw);
      setImportRecords(records);
      const dates = [...new Set(records
        .map((record) => text((record.payload as unknown as Record<string, unknown>).collectionDate))
        .filter(Boolean))];
      if (dates.length === 1) {
        setDateFilter(dates[0]);
        setShowAll(false);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The selected file could not be read.");
    }
  }

  async function stageImportedOrders() {
    if (!importRecords.length || importSummary.duplicateKeys > 0) return;
    setImportBusy(true);
    setImportError(undefined);
    setNotice(undefined);
    try {
      const result = await api.stageBatch(importRecords, await token());
      await queue.refresh();
      setNotice(`Batch staged successfully: ${result.created} new order${result.created === 1 ? "" : "s"}, ${result.existing} already present. Nothing was auto-approved.`);
      setImportRecords([]);
      setImportFileName(undefined);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The order batch could not be staged.");
    } finally {
      setImportBusy(false);
    }
  }

  async function previewReset() {
    setResetBusy(true);
    setNotice(undefined);
    setResetPreview(undefined);
    setResetConfirmation("");
    try {
      const result = await request<ResetPreview>(
        `/api/v1/planning-day/${encodeURIComponent(resetDate)}/reset-preview`,
        await token(),
      );
      setResetPreview(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Planning-day reset preview failed.");
    } finally {
      setResetBusy(false);
    }
  }

  async function resetPlanningDay() {
    if (!resetPreview || resetConfirmation !== resetPreview.confirmation) return;
    setResetBusy(true);
    setNotice(undefined);
    try {
      const result = await request<ResetResult>(
        `/api/v1/planning-day/${encodeURIComponent(resetDate)}?confirm=${encodeURIComponent(resetPreview.confirmation)}`,
        await token(),
        { method: "DELETE" },
        60000,
      );
      setNotice(result.message);
      setResetPreview(undefined);
      setResetConfirmation("");
      await queue.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Planning-day reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

  return <section className="order-review-page">
    <div className="title-row">
      <div>
        <p className="eyebrow">Info mailbox → review → Orders</p>
        <h1>Order review</h1>
        <p className="hint">Customer orders wait here for a human decision. Review the source, correct anything needed, then accept it into the live planning pool.</p>
      </div>
      <button onClick={() => void queue.refresh()} disabled={queue.loading}>Refresh queue</button>
    </div>

    {notice && <p className="notice inline-notice">{notice}</p>}

    <div className="review-metrics">
      <article><span>Waiting</span><strong>{rows.length}</strong><small>Pending customer orders</small></article>
      <article><span>Clean</span><strong>{cleanCount}</strong><small>High-confidence, no warnings</small></article>
      <article className={attentionCount ? "attention" : ""}><span>Needs checking</span><strong>{attentionCount}</strong><small>Missing or uncertain source fields</small></article>
    </div>

    <div className="panel import-panel">
      <div className="import-copy">
        <p className="eyebrow">Manual contingency intake</p>
        <h2>Import orders</h2>
        <p className="hint">Use this for an occasional batch when orders need loading outside the normal Info mailbox automation. The file is previewed first and every record is staged into Order Review — nothing is accepted into planning automatically.</p>
      </div>
      <div className="import-actions">
        <label className="file-picker">Choose JSON batch
          <input type="file" accept=".json,application/json" onChange={(event) => void selectImportFile(event)} disabled={importBusy} />
        </label>
        {importFileName && <span className="import-file-name">{importFileName}</span>}
      </div>

      {importError && <p className="review-error import-message">{importError}</p>}

      {importRecords.length > 0 && <div className="import-preview">
        <div className="import-preview-metrics">
          <article><span>Orders in file</span><strong>{importSummary.total}</strong></article>
          <article className={importSummary.needsCorrection ? "attention" : ""}><span>Need correction</span><strong>{importSummary.needsCorrection}</strong></article>
          <article className={importSummary.missingPo ? "attention" : ""}><span>Missing PO/ref</span><strong>{importSummary.missingPo}</strong></article>
          <article className={importSummary.missingCustomer ? "attention" : ""}><span>Missing customer</span><strong>{importSummary.missingCustomer}</strong></article>
          <article className={importSummary.warningCount ? "attention" : ""}><span>Source warnings</span><strong>{importSummary.warningCount}</strong></article>
        </div>
        <div className="import-preview-detail">
          <div>
            <strong>{importFileName}</strong>
            <span>{importSummary.dates.length ? `Operating date${importSummary.dates.length === 1 ? "" : "s"}: ${importSummary.dates.join(", ")}` : "No collection date found"}</span>
            <span>{importSummary.duplicateKeys ? `${importSummary.duplicateKeys} duplicate idempotency key${importSummary.duplicateKeys === 1 ? "" : "s"} must be corrected before staging.` : "Batch keys are unique."}</span>
            {importSummary.warningCount > 0 && <span>Source warnings are retained for planner context but do not by themselves block staging.</span>}
            {importSummary.missingDate > 0 && <span>{importSummary.missingDate} record{importSummary.missingDate === 1 ? " is" : "s are"} missing a collection date and will require correction before acceptance.</span>}
          </div>
          <button className="primary" onClick={() => void stageImportedOrders()} disabled={importBusy || importSummary.duplicateKeys > 0}>
            {importBusy ? "Staging…" : `Stage ${importSummary.total} order${importSummary.total === 1 ? "" : "s"} for review`}
          </button>
        </div>
      </div>}
    </div>

    <div className="panel reset-panel">
      <div>
        <p className="eyebrow">Operational housekeeping</p>
        <h2>Clear one planning date</h2>
        <p className="hint">This does not run a global reset. It only clears open work for the chosen date; delivered/completed history is retained.</p>
      </div>
      <div className="reset-controls">
        <label>Planning date<input type="date" value={resetDate} onChange={(event) => { setResetDate(event.target.value); setResetPreview(undefined); setResetConfirmation(""); }} /></label>
        <button onClick={() => void previewReset()} disabled={resetBusy || !resetDate}>{resetBusy ? "Checking…" : "Check date"}</button>
      </div>
      {resetPreview && <div className="reset-preview">
        <div><strong>{resetPreview.loads}</strong><span>open runs</span></div>
        <div><strong>{resetPreview.orders}</strong><span>open orders</span></div>
        <div><strong>{resetPreview.staged}</strong><span>staged/fallback records</span></div>
        <label>Type <b>{resetPreview.confirmation}</b> to clear only this date
          <input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder={resetPreview.confirmation} />
        </label>
        <button className="danger-button" onClick={() => void resetPlanningDay()} disabled={resetBusy || resetConfirmation !== resetPreview.confirmation}>Clear {resetDate}</button>
      </div>}
    </div>

    <div className="review-toolbar panel">
      <label>Operating date<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} disabled={showAll} /></label>
      <label className="check-label"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> Show all pending dates</label>
      <span>{visibleRows.length} shown</span>
    </div>

    {queue.error && <div className="state error">{queue.error}</div>}
    {queue.loading && !queue.data && <div className="state">Loading order review queue…</div>}
    {!queue.loading && visibleRows.length === 0 && <div className="state">No customer orders are waiting for review for this date.</div>}

    <div className="order-review-list">
      {visibleRows.map((row) => {
        const payload = editingId === row.item.id && draft ? draft : row.payload;
        const rowWarnings = warnings(row.payload);
        const isEditing = editingId === row.item.id;
        const isBusy = busyId === row.item.id;
        const sourceLink = text(row.payload.sourceWebLink);
        return <article className={`order-review-card confidence-${confidence(row.payload)}`} key={row.item.id}>
          <header>
            <div>
              <div className="review-badges">
                <span className={`confidence-chip ${confidence(row.payload)}`}>{text(row.payload.intakeConfidence) || "Review"}</span>
                <span>{text(row.payload.jobType) || "Order"}</span>
                {rowWarnings.length > 0 && <span className="warning-chip">{rowWarnings.length} warning{rowWarnings.length === 1 ? "" : "s"}</span>}
              </div>
              <h2>{displayPo(row.payload)}</h2>
              <p>{text(row.payload.customerCode) || "Customer missing"} · {text(row.payload.stallNumber) || text(row.payload.marketName) || "Destination to confirm"}</p>
            </div>
            <div className="review-actions">
              {!isEditing && <button onClick={() => beginEdit(row)} disabled={isBusy}>Edit</button>}
              {isEditing && <><button onClick={() => { setEditingId(undefined); setDraft(undefined); }} disabled={isBusy}>Cancel</button><button onClick={() => void saveEdit(row)} disabled={isBusy}>Save</button></>}
              <button className="reject-button" onClick={() => void review(row, false)} disabled={isBusy}>Reject</button>
              <button className="primary" onClick={() => void review(row, true)} disabled={isBusy || Boolean(row.parseError)}>{isBusy ? "Working…" : "Accept order"}</button>
            </div>
          </header>

          {row.parseError && <p className="review-error">The staged payload cannot be read: {row.parseError}</p>}
          {rowWarnings.length > 0 && <div className="warning-list">{rowWarnings.map((warning, index) => <span key={`${row.item.id}-warning-${index}`}>{warning}</span>)}</div>}

          <div className="review-fields">
            <label>Customer<input disabled={!isEditing} value={text(payload.customerCode)} onChange={(event) => setDraft((current) => setField(current || payload, "customerCode", event.target.value))} /></label>
            <label>Customer PO / ref<input disabled={!isEditing} value={text(payload.customerPo)} onChange={(event) => setDraft((current) => setField(current || payload, "customerPo", event.target.value))} /></label>
            <label>TMS order reference<input disabled={!isEditing} value={text(payload.poNumber)} onChange={(event) => setDraft((current) => setField(current || payload, "poNumber", event.target.value))} /></label>
            <label>Collection date<input type="date" disabled={!isEditing} value={text(payload.collectionDate)} onChange={(event) => setDraft((current) => setField(current || payload, "collectionDate", event.target.value))} /></label>
            <label>Delivery date<input type="date" disabled={!isEditing} value={text(payload.deliveryDate)} onChange={(event) => setDraft((current) => setField(current || payload, "deliveryDate", event.target.value))} /></label>
            <label>Pallets<input type="number" min="0" disabled={!isEditing} value={numberText(payload.pallets)} onChange={(event) => setDraft((current) => setField(current || payload, "pallets", event.target.value))} /></label>
            <label>Collection site<input disabled={!isEditing} value={text(payload.sellerName)} onChange={(event) => setDraft((current) => setField(current || payload, "sellerName", event.target.value))} /></label>
            <label>Destination<input disabled={!isEditing} value={text(payload.stallNumber)} onChange={(event) => setDraft((current) => setField(current || payload, "stallNumber", event.target.value))} /></label>
            <label>Requested time<input disabled={!isEditing} value={text(payload.requestedTime)} onChange={(event) => setDraft((current) => setField(current || payload, "requestedTime", event.target.value))} /></label>
            <label>Job type<input disabled={!isEditing} value={text(payload.jobType)} onChange={(event) => setDraft((current) => setField(current || payload, "jobType", event.target.value))} /></label>
          </div>

          <div className="source-evidence">
            <div><span>Source email</span><strong>{text(row.payload.sourceSubject) || row.item.source || "Mailbox source"}</strong></div>
            <div><span>Sender</span><strong>{text(row.payload.sourceSenderName) || text(row.payload.sourceSender) || "—"}</strong><small>{text(row.payload.sourceSender)}</small></div>
            <div><span>Received</span><strong>{formatDateTime(row.payload.sourceReceivedAtUtc || row.item.receivedAtUtc)}</strong></div>
            <div><span>Attachment</span><strong>{text(row.payload.sourceAttachmentName) || "Body-only order"}</strong>{row.payload.sourceSheet && <small>{text(row.payload.sourceSheet)}{row.payload.sourceRow ? ` · row ${row.payload.sourceRow}` : ""}</small>}</div>
            {sourceLink && <a href={sourceLink} target="_blank" rel="noreferrer">Open source email ↗</a>}
          </div>

          {isEditing && <label className="review-notes">Driver/planner notes<textarea rows={3} value={text(payload.driverInstructions)} onChange={(event) => setDraft((current) => setField(current || payload, "driverInstructions", event.target.value))} /></label>}
        </article>;
      })}
    </div>
  </section>;
}
