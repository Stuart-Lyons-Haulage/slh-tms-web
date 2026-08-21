import { useCallback, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type TvPairing = { code: string; createdAtUtc: string; expiresAtUtc: string; tvPath: string };

export function TvDisplaySetup() {
  const token = useAccessToken();
  const pairing = useApi(useCallback(async () => request<TvPairing>("/api/v1/tv-display/pairing-code", await token()), [token]));
  const [message, setMessage] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const tvUrl = useMemo(() => `${window.location.origin}${pairing.data?.tvPath || "/tv"}`, [pairing.data?.tvPath]);
  const expires = pairing.data ? new Date(pairing.data.expiresAtUtc) : undefined;

  async function copyAddress() {
    await navigator.clipboard.writeText(tvUrl);
    setMessage("TV address copied. On the television open this address, then enter the 6-digit pairing code shown here.");
  }

  async function refreshCode() {
    setRefreshing(true);
    setMessage(undefined);
    try {
      await request<TvPairing>("/api/v1/tv-display/pairing-code/refresh", await token(), { method: "POST" });
      await pairing.refresh();
      setMessage("A fresh 6-digit TV code has been generated. Use it within 10 minutes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A new TV pairing code could not be generated.");
    } finally {
      setRefreshing(false);
    }
  }

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Office display</p>
        <h1>TV Live Runs</h1>
        <p className="intro">Pair a television once without signing the TV into Microsoft. After pairing, the TV remembers its secure read-only access.</p>
      </div>
    </div>

    <div className="panel tv-setup-panel">
      <h2>Pair the television</h2>
      <p>On the TV browser enter this short address:</p>
      <div className="tv-setup-address">{tvUrl}</div>
      <div className="route-actions">
        <button type="button" onClick={() => void copyAddress()}>Copy TV address</button>
        <a className="button" href={tvUrl} target="_blank" rel="noopener noreferrer">Open pairing screen ↗</a>
      </div>

      {pairing.loading && <p>Generating a TV pairing code…</p>}
      {pairing.error && <p className="notice inline-notice">{pairing.error}</p>}
      {pairing.data && <div className="tv-pairing-code-panel">
        <span>ENTER THIS CODE ON THE TV</span>
        <strong>{pairing.data.code}</strong>
        <small>{expires ? `Valid until ${expires.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Valid for 10 minutes"}</small>
      </div>}

      <div className="route-actions">
        <button type="button" className="primary" onClick={() => void refreshCode()} disabled={refreshing}>{refreshing ? "Generating…" : "Generate new 6-digit code"}</button>
      </div>

      <p className="hint">The pairing code is one-time and expires after 10 minutes. The television receives only read-only Live Runs access. It cannot open the planner, master data, orders or make changes.</p>
      {message && <p className="notice inline-notice">{message}</p>}
    </div>
  </section>;
}
