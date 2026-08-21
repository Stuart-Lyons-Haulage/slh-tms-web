import { useCallback, useEffect, useMemo, useState } from "react";
import { api, request, type StagedImport } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../order-control.css";

type Payload = Record<string, unknown> & {
  poNumber?: string;
  customerPo?: string;
  customerCode?: string;
  collectionDate?: string;
  deliveryDate?: string;
  pallets?: number | string;
  sellerName?: string;
  stallNumber?: string;
  requestedTime?: string;
  jobType?: string;
  driverInstructions?: string;
  plannerReady?: boolean;
  intakeStatus?: string;
  intakeConfidence?: string;
  intakeWarnings?: string[];
  intakeParser?: string;
  sourceSubject?: string;
  sourceWebLink?: string;
  sourceAttachmentName?: string;
};

type ParsedRow = {
  item: StagedImport;
  payload: Payload;
  parseError?: string;
};

type BulkApproveResponse = {
  date: string;
  requested: number;
  approved: number;
  skipped: number;
  failed: number;
  missing: number;
  message: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const numberText = (value: unknown) => value == null || value === "" ? "" : String(value);

function tomorrowDate() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parse(item: StagedImport): ParsedRow {
  try {
    const payload = JSON.parse(item.payloadJson || "{}") as Payload;
    return { item, payload };
  } catch (error) {
    return {
      item,
      payload: {},
      parseError: error instanceof Error ? error.message : "Invalid staged JSON",
    };
  }
}

function palletCount(payload: Payload) {
  const value = Number(payload.pallets ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function warnings(payload: Payload) {
  return Array.isArray(payload.intakeWarnings) ? payload.intakeWarnings.map(text).filter(Boolean) : [];
}

function blockingReason(row: ParsedRow, date: string) {
  if (row.parseError) return "Payload cannot be read";
  const payload = row.payload;
  if (text(payload.collectionDate) !== date) return "Collection date does not match the selected planning date";
  if (!text(payload.poNumber)) return "TMS reference is missing";
  if (!text(payload.customerCode)) return "Customer is missing";
  if (palletCount(payload) <= 0) return "Zero or missing pallets";
  if (payload.plannerReady === false) return "Pre-order / not planner-ready";
  if (text(payload.intakeStatus).toLowerCase() === "preorder") return "Pre-order awaiting instruction";
  return undefined;
}

function reviewFlagReason(row: ParsedRow) {
  const payload = row.payload;
  const sourceWarnings = warnings(payload);
  if (sourceWarnings.length) return sourceWarnings[0];
  const confidence = text(payload.intakeConfidence);
  if (!confidence || confidence.toLowerCase() !== "high") return confidence ? `${confidence} confidence — check source` : "Source confidence not set — check source";
  return undefined;
}

function displayReference(payload: Payload) {
  return text(payload.customerPo) || text(payload.poNumber) || "Reference missing";
}

export function OrderReviewBulk() {
  const token = useAccessToken();
  const [date, setDate] = useState(tomorrowDate());
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Payload>();

  const queue = useApi(useCallback(async () =>
    api.staging(await token(), "PendingReview", "order", 2000), [token]));

  const rows = useMemo(() => (queue.data || []).map(parse), [queue.data]);
  const datedRows = useMemo(() => rows.filter((row) =>
    text(row.payload.collectionDate) === date || text(row.payload.deliveryDate) === date), [date, rows]);
  const selectableRows = useMemo(() => datedRows.filter((row) => !blockingReason(row, date)), [date, datedRows]);
  const cleanRows = useMemo(() => selectableRows.filter((row) => !reviewFlagReason(row)), [selectableRows]);
  const flaggedRows = useMemo(() => selectableRows.filter((row) => Boolean(reviewFlagReason(row))), [selectableRows]);
  const blockedRows = datedRows.length - selectableRows.length;
  const selectableIds = useMemo(() => new Set(selectableRows.map((row) => row.item.id)), [selectableRows]);
  const selectedRows = useMemo(() => selectableRows.filter((row) => selectedIds.has(row.item.id)), [selectableRows, selectedIds]);
  const selectedPallets = selectedRows.reduce((sum, row) => sum + palletCount(row.payload), 0);
  const allCleanSelected = cleanRows.length > 0 && cleanRows.every((row) => selectedIds.has(row.item.id));

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => selectableIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [selectableIds]);

  function toggleRow(id: string) {
    if (!selectableIds.has(id) || busy || busyId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllClean() {
    if (busy || busyId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allCleanSelected) cleanRows.forEach((row) => next.delete(row.item.id));
      else cleanRows.forEach((row) => next.add(row.item.id));
      return next;
    });
  }

  function beginEdit(row: ParsedRow) {
    setEditingId(row.item.id);
    setDraft({ ...row.payload });
    setNotice(undefined);
  }

  async function saveEdit(row: ParsedRow) {
    if (!draft) return;
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      const next: Payload = {
        ...row.payload,
        ...draft,
        pallets: numberText(draft.pallets) === "" ? undefined : Number(draft.pallets),
      };
      await request<StagedImport>(`/api/v1/staging/${row.item.id}/payload`, await token(), {
        method: "PUT",
        body: JSON.stringify({ payload: next, note: "Corrected directly in Order Control before approval." }),
      });
      setEditingId(undefined);
      setDraft(undefined);
      await queue.refresh();
      setNotice(`${displayReference(next)} updated and kept waiting for approval.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The staged order could not be saved.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function rejectRow(row: ParsedRow) {
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      await api.review(row.item.id, false, "Rejected from Order Control before planning.", await token());
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(row.item.id);
        return next;
      });
      if (editingId === row.item.id) {
        setEditingId(undefined);
        setDraft(undefined);
      }
      await queue.refresh();
      setNotice(`${displayReference(row.payload)} rejected. The source evidence remains in the audit history.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The order could not be rejected.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function approveSelectedOrders() {
    if (!selectedRows.length || busy || busyId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await request<BulkApproveResponse>(
        "/api/v1/staging/orders/bulk-approve",
        await token(),
        {
          method: "POST",
          body: JSON.stringify({
            date,
            ids: selectedRows.map((row) => row.item.id),
            acknowledgeReviewFlags: true,
          }),
        },
        120000,
      );
      setNotice(`${result.message}${result.skipped || result.failed ? ` ${result.skipped} skipped and ${result.failed} failed remain for review.` : ""}`);
      setSelectedIds(new Set());
      setEditingId(undefined);
      setDraft(undefined);
      await queue.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Selected approval failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel order-selection-panel">
    <div className="title-row" style={{ alignItems: "end" }}>
      <div>
        <p className="eyebrow">Waiting for approval</p>
        <h2>Review and approve orders</h2>
        <p className="hint">Clean jobs can be selected together. Jobs with review flags can still be opened, corrected and selected individually. Only genuinely incomplete or pre-order work is blocked from approval.</p>
      </div>
      <label>
        Planning date
        <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedIds(new Set()); setEditingId(undefined); setDraft(undefined); }} disabled={busy || Boolean(busyId)} />
      </label>
    </div>

    <div className="review-metrics" style={{ marginTop: 14 }}>
      <article><span>Waiting</span><strong>{datedRows.length}</strong><small>Pending on selected date</small></article>
      <article><span>Clean</span><strong>{cleanRows.length}</strong><small>Can be selected together</small></article>
      <article className={flaggedRows.length ? "attention" : ""}><span>Check then approve</span><strong>{flaggedRows.length}</strong><small>Individually selectable after review</small></article>
      {blockedRows > 0 && <article className="attention"><span>Blocked</span><strong>{blockedRows}</strong><small>Must be corrected first</small></article>}
    </div>

    {notice && <p className="notice inline-notice">{notice}</p>}
    {queue.error && <p className="review-error">{queue.error}</p>}

    <div className="bulk-selection-toolbar">
      <label className="bulk-select-all">
        <input type="checkbox" checked={allCleanSelected} onChange={toggleAllClean} disabled={busy || Boolean(busyId) || cleanRows.length === 0} />
        <span>{allCleanSelected ? "All clean orders selected" : `Select all ${cleanRows.length} clean orders`}</span>
      </label>
      <span className="bulk-selection-count"><strong>{selectedRows.length}</strong> selected · {selectedPallets} pallets</span>
      <button onClick={() => setSelectedIds(new Set())} disabled={busy || Boolean(busyId) || selectedRows.length === 0}>Clear selection</button>
      <button className="primary" onClick={() => void approveSelectedOrders()} disabled={busy || Boolean(busyId) || selectedRows.length === 0}>
        {busy ? "Approving…" : `Approve selected (${selectedRows.length})`}
      </button>
    </div>

    {flaggedRows.length > 0 && <p className="order-review-explainer">The {flaggedRows.length} amber jobs are <strong>not locked</strong>. Open Edit to check/correct the source fields, then tick each job you are satisfied with. They are deliberately excluded from “Select all clean”.</p>}

    {queue.loading && !queue.data && <div className="state">Loading orders waiting for approval…</div>}
    {!queue.loading && datedRows.length === 0 && <div className="state">No orders are waiting for approval for this date.</div>}

    {datedRows.length > 0 && <div className="bulk-order-list" role="list" aria-label="Orders waiting for approval">
      {datedRows.map((row) => {
        const blocked = blockingReason(row, date);
        const reviewFlag = !blocked ? reviewFlagReason(row) : undefined;
        const selectable = !blocked;
        const selected = selectedIds.has(row.item.id);
        const isEditing = editingId === row.item.id;
        const rowBusy = busyId === row.item.id;
        const sourceWarnings = warnings(row.payload);
        const payload = isEditing && draft ? draft : row.payload;
        const sourceLink = text(row.payload.sourceWebLink);
        const statusClass = blocked ? "blocked" : reviewFlag ? "review" : "ready";
        const statusText = blocked ? blocked : reviewFlag ? `Check: ${reviewFlag}` : "Ready to approve";

        return <article className={`bulk-order-row ${selectable ? "selectable" : "held"} ${selected ? "selected" : ""} ${isEditing ? "editing" : ""}`} key={row.item.id} role="listitem">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleRow(row.item.id)}
            disabled={!selectable || busy || Boolean(busyId)}
            aria-label={`Select ${displayReference(row.payload)}`}
          />
          <span className="bulk-order-ref"><strong>{displayReference(row.payload)}</strong><small>{text(row.payload.poNumber) || "TMS reference missing"}</small></span>
          <span><strong>{text(row.payload.customerCode) || "Customer missing"}</strong><small>{text(row.payload.sellerName) || "Collection site missing"} → {text(row.payload.stallNumber) || "Destination missing"}</small></span>
          <span className="bulk-order-pallets"><strong>{palletCount(row.payload)}</strong><small>pallets</small></span>
          <span className={`bulk-order-status ${statusClass}`}>{statusText}</span>
          <div className="bulk-order-actions">
            {!isEditing && <button type="button" onClick={() => beginEdit(row)} disabled={busy || Boolean(busyId)}>Edit</button>}
            {isEditing && <>
              <button type="button" onClick={() => { setEditingId(undefined); setDraft(undefined); }} disabled={rowBusy}>Cancel</button>
              <button type="button" className="primary" onClick={() => void saveEdit(row)} disabled={rowBusy}>{rowBusy ? "Saving…" : "Save"}</button>
            </>}
            <button type="button" className="reject-button" onClick={() => void rejectRow(row)} disabled={busy || Boolean(busyId)}>{rowBusy ? "Working…" : "Reject"}</button>
          </div>

          {(reviewFlag || sourceWarnings.length > 0) && !isEditing && <div className="bulk-row-warning">
            <strong>{reviewFlag ? "Why this needs checking" : "Source warning"}</strong>
            {sourceWarnings.length > 0 ? sourceWarnings.map((warning, index) => <span key={`${row.item.id}-warning-${index}`}>{warning}</span>) : <span>{reviewFlag}</span>}
          </div>}

          {isEditing && <div className="bulk-order-editor">
            <div className="bulk-editor-grid">
              <label>Customer<input value={text(payload.customerCode)} onChange={(event) => setDraft((current) => ({ ...(current || payload), customerCode: event.target.value }))} /></label>
              <label>Customer PO / ref<input value={text(payload.customerPo)} onChange={(event) => setDraft((current) => ({ ...(current || payload), customerPo: event.target.value }))} /></label>
              <label>TMS order reference<input value={text(payload.poNumber)} onChange={(event) => setDraft((current) => ({ ...(current || payload), poNumber: event.target.value }))} /></label>
              <label>Collection date<input type="date" value={text(payload.collectionDate)} onChange={(event) => setDraft((current) => ({ ...(current || payload), collectionDate: event.target.value }))} /></label>
              <label>Delivery date<input type="date" value={text(payload.deliveryDate)} onChange={(event) => setDraft((current) => ({ ...(current || payload), deliveryDate: event.target.value }))} /></label>
              <label>Pallets<input type="number" min="0" value={numberText(payload.pallets)} onChange={(event) => setDraft((current) => ({ ...(current || payload), pallets: event.target.value }))} /></label>
              <label>Collection site<input value={text(payload.sellerName)} onChange={(event) => setDraft((current) => ({ ...(current || payload), sellerName: event.target.value }))} /></label>
              <label>Destination<input value={text(payload.stallNumber)} onChange={(event) => setDraft((current) => ({ ...(current || payload), stallNumber: event.target.value }))} /></label>
              <label>Requested time<input value={text(payload.requestedTime)} onChange={(event) => setDraft((current) => ({ ...(current || payload), requestedTime: event.target.value }))} /></label>
              <label>Job type<input value={text(payload.jobType)} onChange={(event) => setDraft((current) => ({ ...(current || payload), jobType: event.target.value }))} /></label>
            </div>
            <label className="bulk-editor-notes">Driver / planner notes<textarea rows={3} value={text(payload.driverInstructions)} onChange={(event) => setDraft((current) => ({ ...(current || payload), driverInstructions: event.target.value }))} /></label>
            <div className="bulk-source-line">
              <span><strong>Source:</strong> {text(row.payload.sourceSubject) || row.item.source || "Order intake"}</span>
              {row.payload.sourceAttachmentName && <span><strong>Attachment:</strong> {text(row.payload.sourceAttachmentName)}</span>}
              {row.payload.intakeParser && <span><strong>Parser:</strong> {text(row.payload.intakeParser)}</span>}
              {sourceLink && <a href={sourceLink} target="_blank" rel="noreferrer">Open source email ↗</a>}
            </div>
          </div>}
        </article>;
      })}
    </div>}
  </section>;
}
