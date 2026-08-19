import { useCallback, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

 type TvAccess = { key: string; createdAtUtc: string; urlPath: string };

export function TvDisplaySetup() {
  const token = useAccessToken();
  const access = useApi(useCallback(async () => request<TvAccess>("/api/v1/tv-display/key", await token()), [token]));
  const [message, setMessage] = useState<string>();
  const [rotating, setRotating] = useState(false);

  const fullUrl = access.data ? `${window.location.origin}${access.data.urlPath}` : "";

  async function copyLink() {
    if (!fullUrl) return;
    await navigator.clipboard.writeText(fullUrl);
    setMessage("TV link copied. Open this URL on the television browser and it will display Live Runs without Microsoft sign-in.");
  }

  async function rotate() {
    if (!window.confirm("Generate a new TV display link? The existing television link will stop working immediately.")) return;
    setRotating(true);
    setMessage(undefined);
    try {
      const result = await request<TvAccess>("/api/v1/tv-display/key/rotate", await token(), { method: "POST" });
      await navigator.clipboard.writeText(`${window.location.origin}${result.urlPath}`);
      await access.refresh();
      setMessage("A new TV link has been generated and copied. Replace the old URL on the television.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The TV display link could not be rotated.");
    } finally {
      setRotating(false);
    }
  }

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Office display</p><h1>TV Live Runs</h1><p className="intro">Use this read-only link on a television or browser that does not have a Lyons Microsoft account.</p></div>
    </div>
    <div className="panel">
      <h2>Secure television link</h2>
      <p>The link can only read the live-runs display feed. It cannot open the planner, master data, orders, costs or make any changes.</p>
      {access.loading && <p>Preparing the TV link…</p>}
      {access.error && <p className="notice inline-notice">{access.error}</p>}
      {access.data && <>
        <label>TV URL<input readOnly value={fullUrl} onFocus={event => event.currentTarget.select()} /></label>
        <div className="route-actions">
          <button type="button" className="primary" onClick={() => void copyLink()}>Copy TV link</button>
          <a className="button" href={fullUrl} target="_blank" rel="noopener noreferrer">Open TV view ↗</a>
          <button type="button" onClick={() => void rotate()} disabled={rotating}>{rotating ? "Generating…" : "Generate new link"}</button>
        </div>
        <p className="hint">Keep this URL within the business. If a television is replaced or the link is shared accidentally, generate a new one here.</p>
      </>}
      {message && <p className="notice inline-notice">{message}</p>}
    </div>
  </section>;
}
