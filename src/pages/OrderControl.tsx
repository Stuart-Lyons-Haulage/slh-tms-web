import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { JobsOperational } from "./JobsOperational";
import { OrderReviewBulk } from "./OrderReviewBulk";

type OrderControlTab = "review" | "live";
type NwfRepairResponse = { repaired: number; message: string };

export function OrderControl({ initialTab = "review" }: { initialTab?: OrderControlTab }) {
  const token = useAccessToken();
  const [tab, setTab] = useState<OrderControlTab>(initialTab);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [repairNotice, setRepairNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await request<NwfRepairResponse>("/api/v1/staging/orders/repair-nwf-references", await token(), { method: "POST" });
        if (!active || result.repaired <= 0) return;
        setRepairNotice(result.message);
        setReviewVersion((value) => value + 1);
      } catch {
        // Compatibility repair only; new imports already use the corrected PO-first parser.
      }
    })();
    return () => { active = false; };
  }, [token]);

  return <>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ alignItems: "end" }}>
        <div>
          <p className="eyebrow">Info mailbox → load review → live planning</p>
          <h1>Load Review</h1>
          <p className="hint">Review incoming transport work before it reaches the plan. This covers pallets, trays, trolleys, crates, mixed loads, markets, transfers and amendments rather than treating everything as a pallet order.</p>
        </div>
        <div className="title-actions" role="tablist" aria-label="Load Review view">
          <button type="button" className={tab === "review" ? "primary" : ""} onClick={() => setTab("review")} role="tab" aria-selected={tab === "review"}>
            Waiting for review
          </button>
          <button type="button" className={tab === "live" ? "primary" : ""} onClick={() => setTab("live")} role="tab" aria-selected={tab === "live"}>
            Approved / live loads
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        {tab === "review"
          ? "Review, amend, reject or approve staged load instructions. Approval remains mandatory before the work enters live planning."
          : "Amend or cancel already-approved work without leaving Load Review; the source and audit history are retained."}
      </p>
      {repairNotice && <p className="notice inline-notice" style={{ marginBottom: 0 }}>{repairNotice}</p>}
    </section>

    {tab === "review" ? <OrderReviewBulk key={reviewVersion} /> : <JobsOperational />}
  </>;
}
