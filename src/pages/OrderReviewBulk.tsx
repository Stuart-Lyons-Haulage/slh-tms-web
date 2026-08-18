import { useCallback, useMemo, useState } from "react";
import { api, request, type StagedImport } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { OrderReviewOperational } from "./OrderReviewOperational";

type Payload = Record<string, unknown> & {
  poNumber?: string;
  customerCode?: string;
  collectionDate?: string;
  deliveryDate?: string;
  pallets?: number | string;
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

function isSafeForBulk(row: ParsedRow, date: string) {
  if (row.parseError) return false;
  const payload = row.payload;
  if (text(payload.collectionDate) !== date) return false;
  if (!text(payload.poNumber) || !text(payload.customerCode)) return false;
  if (palletCount(payload) <= 0) return false;
  if (payload.plannerReady === false) return false;
  if (text(payload.intakeStatus).toLowerCase() === "preorder") return false;
  if (text(payload.intakeConfidence).toLowerCase() !== "high") return false;
  if (Array.isArray(payload.intakeWarnings) && payload.intakeWarnings.length > 0) return false;
  return true;
}

export function OrderReviewBulk() {
  const token = useAccessToken();
  const [date, setDate] = useState(tomorrowDate());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [reviewVersion, setReviewVersion] = useState(0);

  const queue = useApi(useCallback(async () =>
    api.staging(await token(), "PendingReview", "order", 2000), [token]));

  const rows = useMemo(() => (queue.data || []).map(parse), [queue.data]);
  const datedRows = useMemo(() => rows.filter((row) =>
    text(row.payload.collectionDate) === date || text(row.payload.deliveryDate) === date), [date, rows]);
  const safeRows = useMemo(() => datedRows.filter((row) => isSafeForBulk(row, date)), [date, datedRows]);
  const heldRows = datedRows.length - safeRows.length;
  const safePallets = safeRows.reduce((sum, row) => sum + palletCount(row.payload), 0);

  async function approveCleanOrders() {
    if (!safeRows.length || busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await request<BulkApproveResponse>(
        "/api/v1/staging/orders/bulk-approve",
        await token(),
        {
          method: "POST",
          body: JSON.stringify({ date, ids: safeRows.map((row) => row.item.id) }),
        },
        120000,
      );
      setNotice(`${result.message}${result.skipped || result.failed ? ` ${result.skipped} skipped and ${result.failed} failed remain for review.` : ""}`);
      await queue.refresh();
      setReviewVersion((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Mass approval failed.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ alignItems: "end" }}>
        <div>
          <p className="eyebrow">Controlled mass approval</p>
          <h2>Approve clean orders together</h2>
          <p className="hint">Only high-confidence, planner-ready orders with a positive pallet quantity and no intake warnings are included. Anything uncertain stays in Order Review for individual checking.</p>
        </div>
        <label>
          Planning date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={busy} />
        </label>
      </div>

      <div className="review-metrics" style={{ marginTop: 14 }}>
        <article><span>On selected date</span><strong>{datedRows.length}</strong><small>Pending order records</small></article>
        <article><span>Safe to approve</span><strong>{safeRows.length}</strong><small>{safePallets} pallets</small></article>
        <article className={heldRows ? "attention" : ""}><span>Held for review</span><strong>{heldRows}</strong><small>Warnings, pre-orders, zero pallets or incomplete data</small></article>
      </div>

      {notice && <p className="notice inline-notice">{notice}</p>}
      {queue.error && <p className="review-error">{queue.error}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <button className="primary" onClick={() => void approveCleanOrders()} disabled={busy || queue.loading || safeRows.length === 0}>
          {busy ? "Approving…" : `Approve ${safeRows.length} clean order${safeRows.length === 1 ? "" : "s"}`}
        </button>
        <button onClick={() => void queue.refresh()} disabled={busy || queue.loading}>Refresh approval count</button>
        <span className="hint">This never mass-approves uncertain orders.</span>
      </div>
    </section>

    <OrderReviewOperational key={reviewVersion} />
  </>;
}
