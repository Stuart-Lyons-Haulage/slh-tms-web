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
        // The repair is compatibility-only and must never stop Order Control loading.
        // New imports already use the corrected PO-first parser.
      }
    })();
    return () => { active = false; };
  }, [token]);

  return <>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ alignItems: "end" }}>
        <div>
          <p className="eyebrow">Info mailbox → human review → live planning</p>
          <h1>Order control</h1>
          <p className="hint">One place to check incoming customer orders before approval and maintain work that has already been accepted into the TMS.</p>
        </div>
        <div className="title-actions" role="tablist" aria-label="Order control view">
          <button type="button" className={tab === "review" ? "primary" : ""} onClick={() => setTab("review")} role="tab" aria-selected={tab === "review"}>
            Waiting for approval
          </button>
          <button type="button" className={tab === "live" ? "primary" : ""} onClick={() => setTab("live")} role="tab" aria-selected={tab === "live"}>
            Approved / live jobs
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        {tab === "review"
          ? "Review, amend, reject or approve staged orders. Approval remains mandatory before an order enters live planning."
          : "Amend or cancel an already-approved job without leaving Order control; the audit record is retained."}
      </p>
      {repairNotice && <p className="notice inline-notice" style={{ marginBottom: 0 }}>{repairNotice}</p>}
    </section>

    {tab === "review" ? <OrderReviewBulk key={reviewVersion} /> : <JobsOperational />}
  </>;
}
