import { useCallback, useEffect, useState, type FormEvent } from "react";
import { OperationsWallboard } from "./OperationsWallboard";
import "../tv-display.css";

type PairResponse = { key: string; pairedAtUtc: string };

const UK_ZONE = "Europe/London";
const STORAGE_KEY = "slh-tv-display-key";
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function initialDisplayKey() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const legacy = new URLSearchParams(hash).get("key")?.trim() || new URLSearchParams(window.location.search).get("key")?.trim();
  if (legacy) {
    localStorage.setItem(STORAGE_KEY, legacy);
    window.history.replaceState(null, "", window.location.pathname);
    return legacy;
  }
  return localStorage.getItem(STORAGE_KEY)?.trim() || "";
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
}

function TvOperationsBoard({ displayKey, onUnauthorized }: { displayKey: string; onUnauthorized: () => void }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (!url.includes("/api/v1/")) return originalFetch(input, init);

      const headers = requestHeaders(input, init);
      headers.set("X-TV-Display-Key", displayKey);
      headers.set("X-TMS-TV-Key", displayKey);
      const response = await originalFetch(input, { ...init, headers });
      if (response.status === 401) onUnauthorized();
      return response;
    };

    window.fetch = patchedFetch;
    setReady(true);
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, [displayKey, onUnauthorized]);

  if (!ready) return <div className="tv-display-page"><div className="tv-display-empty">Connecting TV wallboard…</div></div>;

  // The paired TV now mounts the exact Operations wallboard used in the signed-in TMS.
  // tvMode keeps the TV presentation/read-only behaviour and suppresses TMS-only
  // geofence linkage diagnostics, while the fetch wrapper supplies the paired display key.
  return <OperationsWallboard tvMode />;
}

export function PublicTvBoard() {
  const [displayKey, setDisplayKey] = useState(initialDisplayKey);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string>();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    if (displayKey) return;
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(clockTimer);
  }, [displayKey]);

  async function pair(event: FormEvent) {
    event.preventDefault();
    const code = pairCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setError("Enter all 6 digits from the TMS TV display page.");
      return;
    }

    setPairing(true);
    setError(undefined);
    try {
      const response = await fetch("/tms-api/api/v1/tv-display/pair", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        let detail = "That pairing code could not be accepted.";
        try { detail = (await response.json() as { message?: string }).message || detail; } catch { /* keep generic detail */ }
        throw new Error(detail);
      }
      const result = await response.json() as PairResponse;
      localStorage.setItem(STORAGE_KEY, result.key);
      setDisplayKey(result.key);
      setPairCode("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The TV could not be paired.");
    } finally {
      setPairing(false);
    }
  }

  const resetPairing = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setDisplayKey("");
    setError("This TV needs pairing again. Enter the current 6-digit code from TV display in the signed-in TMS.");
  }, []);

  if (displayKey) return <TvOperationsBoard displayKey={displayKey} onUnauthorized={resetPairing} />;

  return <div className="tv-display-page tv-pair-page">
    <header className="tv-display-header">
      <div className="tv-display-brand"><span>SLH</span><div><small>LIVE OPERATIONS</small><h1>Pair this TV</h1></div></div>
      <div className="tv-display-clock"><strong>{timeFormat.format(clock)}</strong><span>{dateFormat.format(clock)}</span></div>
    </header>
    <section className="tv-pair-card">
      <p className="tv-pair-step">ONE-TIME SETUP</p>
      <h2>Enter the 6-digit TV code</h2>
      <p>On a signed-in phone or computer open <strong>TV display</strong> in the TMS. Enter the code shown there below.</p>
      <form onSubmit={event => void pair(event)}>
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pairCode}
          onChange={event => setPairCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          aria-label="Six digit TV pairing code"
        />
        <button className="primary" type="submit" disabled={pairing || pairCode.length !== 6}>{pairing ? "Pairing…" : "Pair TV"}</button>
      </form>
      {error && <div className="tv-display-error"><strong>Pairing not completed</strong><span>{error}</span></div>}
      <p className="tv-pair-hint">Once paired, this television remembers the secure display key and opens the same live Operations wallboard logic used by the TMS.</p>
    </section>
  </div>;
}
