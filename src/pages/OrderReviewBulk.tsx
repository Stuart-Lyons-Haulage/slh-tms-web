import { useCallback, useEffect, useMemo, useState } from "react";
import { api, request, type StagedImport } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import "../order-control.css";
import { OrderReviewOperational } from "./OrderReviewOperational";

type Payload = Record<string, unknown> & {
  poNumber?: string;
  customerPo?: string;
  customerCode?: string;
  collectionDate?: string;
  deliveryDate?: string;
  pallets?: number | string;
  sellerName?: string;
  stallNumber?: string;
  plannerReady?: boolean;
  intakeStatus?: string;
  intakeConfidence?: string;
  intakeWarnings?: string[];
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

function eligibilityReason(row: ParsedRow, date: string) {
  if (row.parseError) return "Payload cannot be read";
  const payload = row.payload;
  if (text(payload.collectionDate) !== date) return "Different collection date";
  if (!text(payload.poNumber) || !text(payload.customerCode)) return "Missing reference or customer";
  if (palletCount(payload) <= 0) return "Zero or missing pallets";
  if (payload.plannerReady === false) return "Pre-order / not planner-ready";
  if (text(payload.intakeStatus).toLowerCase() === "preorder") return "Pre-order awaiting instruction";
  if (text(payload.intakeConfidence).toLowerCase() !== "high") return "Needs individual review";
  if (Array.isArray(payload.intakeWarnings) && payload.intakeWarnings.length > 0) return "Source warning needs review";
  return undefined;
}

function displayReference(payload: Payload) {
  return text(payload.customerPo) || text(payload.poNumber) || "Reference missing";
}

export function OrderReviewBulk() {
  const token = useAccessToken();
  const [date, setDate] = useState(tomorrowDate());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [reviewVersion, setReviewVersion] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const queue = useApi(useCallback(async () =>
    api.staging(await token(), "PendingReview", "order", 2000), [token]));

  const rows = useMemo(() => (queue.data || []).map(parse), [queue.data]);
  const datedRows = useMemo(() => rows.filter((row) =>
    text(row.payload.collectionDate) === date || text(row.payload.deliveryDate) === date), [date, rows]);
  const safeRows = useMemo(() => datedRows.filter((row) => !eligibilityReason(row, date)), [date, datedRows]);
  const heldRows = datedRows.length - safeRows.length;
  const safePallets = safeRows.reduce((sum, row) => sum + palletCount(row.payload), 0);
  const safeIds = useMemo(() => new Set(safeRows.map((row) => row.item.id)), [safeRows]);
  const selectedRows = useMemo(() => safeRows.filter((row) => selectedIds.has(row.item.id)), [safeRows, selectedIds]);
  const selectedPallets = selectedRows.reduce((sum, row) => sum + palletCount(row.payload), 0);
  const allSafeSelected = safeRows.length > 0 && safeRows.every((row) => selectedIds.has(row.item.id));

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => safeIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [safeIds]);

  function toggleRow(id: string) {
    if (!safeIds.has(id) || busy) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSafe() {
    if (busy) return;
    setSelectedIds(allSafeSelected ? new Set() : new Set(safeRows.map((row) => row.item.id)));
  }

  async function approveSelectedOrders() {
    if (!selectedRows.length || busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await request<BulkApproveResponse>(
        "/api/v1/staging/orders/bulk-approve",
        await token(),
        {
          method: "POST",
          body: JSON.stringify({ date, ids: selectedRows.map((row) => row.item.id) }),
        },
        120000,
      );
      setNotice(`${result.message}${result.skipped || result.failed ? ` ${result.skipped} skipped and ${result.failed} failed remain for review.` : ""}`);
      setSelectedIds(new Set());
      await queue.refresh();
      setReviewVersion((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Selected approval failed.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className="panel order-selection-panel" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ alignItems: "end" }}>
        <div>
          <p className="eyebrow">Waiting for approval</p>
          <h2>Select orders to approve</h2>
          <p className="hint">Tick individual clean orders, or select them all. Orders with warnings or incomplete information stay locked for individual checking below.</p>
        </div>
        <label>
          Planning date
          <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedIds(new Set()); }} disabled={busy} />
        </label>
      </div>

      <div className="review-metrics" style={{ marginTop: 14 }}>
        <article><span>On selected date</span><strong>{datedRows.length}</strong><small>Pending order records</small></article>
        <article><span>Selectable</span><strong>{safeRows.length}</strong><small>{safePallets} pallets</small></article>
        <article className={heldRows ? "attention" : ""}><span>Need individual review</span><strong>{heldRows}</strong><small>Warnings, pre-orders or incomplete data</small></article>
      </div>

      {notice && <p className="notice inline-notice">{notice}</p>}
      {queue.error && <p className="review-error">{queue.error}</p>}

      <div className="bulk-selection-toolbar">
        <label className="bulk-select-all">
          <input type="checkbox" checked={allSafeSelected} onChange={toggleAllSafe} disabled={busy || safeRows.length === 0} />
          <span>{allSafeSelected ? "All selectable orders selected" : `Select all ${safeRows.length} clean orders`}</span>
        </label>
        <span className="bulk-selection-count"><strong>{selectedRows.length}</strong> selected · {selectedPallets} pallets</span>
        <button onClick={() => setSelectedIds(new Set())} disabled={busy || selectedRows.length === 0}>Clear selection</button>
        <button className="primary" onClick={() => void approveSelectedOrders()} disabled={busy || selectedRows.length === 0}>
          {busy ? "Approving…" : `Approve selected (${selectedRows.length})`}
        </button>
      </div>

      {queue.loading && !queue.data && <div className="state">Loading orders waiting for approval…</div>}
      {!queue.loading && datedRows.length === 0 && <div className="state">No orders are waiting for approval for this date.</div>}

      {datedRows.length > 0 && <div className="bulk-order-list" role="list" aria-label="Orders waiting for approval">
        {datedRows.map((row) => {
          const reason = eligibilityReason(row, date);
          const selectable = !reason;
          const selected = selectedIds.has(row.item.id);
          return <label className={`bulk-order-row ${selectable ? "selectable" : "held"} ${selected ? "selected" : ""}`} key={row.item.id} role="listitem">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleRow(row.item.id)}
              disabled={!selectable || busy}
              aria-label={`Select ${displayReference(row.payload)}`}
            />
            <span className="bulk-order-ref"><strong>{displayReference(row.payload)}</strong><small>{text(row.payload.poNumber) || "TMS reference missing"}</small></span>
            <span><strong>{text(row.payload.customerCode) || "Customer missing"}</strong><small>{text(row.payload.sellerName) || "Collection site missing"} → {text(row.payload.stallNumber) || "Destination missing"}</small></span>
            <span className="bulk-order-pallets"><strong>{palletCount(row.payload)}</strong><small>pallets</small></span>
            <span className={`bulk-order-status ${selectable ? "ready" : "held"}`}>{selectable ? "Ready to approve" : reason}</span>
          </label>;
        })}
      </div>}

      <p className="hint bulk-detail-hint">Need to correct, reject or inspect a source email? Use the individual order cards below.</p>
    </section>

    <OrderReviewOperational key={reviewVersion} />
  </>;
}
