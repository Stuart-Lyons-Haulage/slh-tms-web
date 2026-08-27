import { useCallback, useState } from "react";
import { ExportCentre as LegacyExportCentre } from "./Pages";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { runtimeConfig } from "../lib/runtimeConfig";
import { useApi } from "../lib/useApi";

type CustomerEtaEvidenceSummary = {
  planningDate: string;
  generatedAtUtc: string;
  source: string;
  recordCount: number;
  deliveryCount: number;
  customerPromiseReadyCount: number;
};

const baseUrl = runtimeConfig.apiBaseUrl.replace(/\/$/, "");

export function ExportCentre() {
  const token = useAccessToken();
  const [date, setDate] = useState(todayIsoDate());
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string>();

  const evidence = useApi(useCallback(async () =>
    request<CustomerEtaEvidenceSummary>(
      `/api/v1/operations/customer-eta-evidence?date=${encodeURIComponent(date)}`,
      await token(),
      undefined,
      60000,
    ), [date, token]));

  async function downloadEvidence() {
    setDownloading(true);
    setMessage(undefined);
    try {
      const accessToken = await token();
      const response = await fetch(
        `${baseUrl}/api/v1/operations/customer-eta-evidence/export.csv?date=${encodeURIComponent(date)}`,
        { headers: { Accept: "text/csv", Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail || detail?.message || `ETA evidence export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SLH-customer-ETA-evidence-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Customer ETA evidence exported with Tacho, tracking, geofence and route proof.");
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "Customer ETA evidence could not be exported.");
    } finally {
      setDownloading(false);
    }
  }

  return <>
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Customer service evidence</p>
          <h1>Customer ETA proof</h1>
          <p className="intro">One evidence chain from planned allocation and TachoMaster sign-on through DOT/Falcon movement, confirmed site visits and the live route ETA.</p>
        </div>
        <label className="dashboard-date">Operating date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      </div>
      <div className="metrics">
        <article><span>Delivery stops</span><strong>{evidence.data?.deliveryCount ?? "—"}</strong><small>In the evidence export</small></article>
        <article><span>Customer-ready ETA</span><strong>{evidence.data?.customerPromiseReadyCount ?? "—"}</strong><small>Fresh live tracking + matched Tacho duty</small></article>
        <article><span>Evidence source</span><strong>{evidence.data ? "LIVE" : "—"}</strong><small>Tacho · DOT/Falcon · geofence · Azure Maps</small></article>
      </div>
      {evidence.error && <p className="notice inline-notice">ETA evidence check: {evidence.error}</p>}
      <div className="panel">
        <h2>Export customer ETA evidence</h2>
        <p>The CSV proves the basis of each delivery ETA: allocated run, driver and vehicle; Tacho sign-on; first vehicle movement; latest tracking; last confirmed site arrival/departure; live or planned ETA source; driving time remaining; statutory break allowance; delivery-window risk; and whether the ETA is safe to present as customer-ready.</p>
        <button className="primary" type="button" disabled={downloading || evidence.loading} onClick={() => void downloadEvidence()}>{downloading ? "Building evidence…" : "Download customer ETA proof CSV"}</button>
        <p className="hint">A delivery is only marked <strong>Customer promise ready</strong> when the route is live, tracking is fresh, a current TachoMaster duty is matched and the ETA remains legally achievable with any required break included.</p>
        {message && <p className="notice inline-notice">{message}</p>}
      </div>
    </section>
    <LegacyExportCentre />
  </>;
}
