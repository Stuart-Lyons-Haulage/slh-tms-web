import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, request } from "../lib/api";
import { todayIsoDate } from "../lib/dateUtils";
import { OperationsWallboard } from "./OperationsWallboard";
import { clearDisplayKey, readStoredDisplayKey, storeDisplayKey } from "./publicTvStorage";
import "../tv-display.css";

type PairResponse = { key: string; pairedAtUtc: string };

const UK_ZONE = "Europe/London";
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: UK_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function initialDisplayKey() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const legacy = new URLSearchParams(hash).get("key")?.trim() || new URLSearchParams(window.location.search).get("key")?.trim();
  if (legacy) {
    storeDisplayKey(legacy);
    try { window.history.replaceState(null, "", window.location.pathname); } catch { /* keep key in current URL if history is restricted */ }
    return legacy;
  }
  return readStoredDisplayKey();
}

function tvHeaders(displayKey: string): HeadersInit {
  return {
    "X-TV-Display-Key": displayKey,
    "X-TMS-TV-Key": displayKey,
  };
}

function TvOperationsBoard({ displayKey, onUnauthorized }: { displayKey: string; onUnauthorized: () => void }) {
  const [connection, setConnection] = useState<"checking" | "ready" | "error">("checking");
  const [connectionError, setConnectionError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setConnection("checking");
    setConnectionError(undefined);
    void request<unknown>(
      `/api/v1/tv-display/planned-runs?date=${encodeURIComponent(todayIsoDate())}`,
      undefined,
      { headers: tvHeaders(displayKey), cache: "no-store" },
    ).then(() => {
      if (!cancelled) setConnection("ready");
    }).catch((exception: unknown) => {
      if (cancelled) return;
      if (exception instanceof ApiError && exception.status === 401) {
        onUnauthorized();
        return;
      }
      setConnectionError(exception instanceof Error ? exception.message : "The TV wallboard could not connect to the TMS API.");
      setConnection("error");
    });
    return () => { cancelled = true; };
  }, [displayKey, onUnauthorized]);

  if (connection === "checking") return <div className="tv-display-page"><div className="tv-display-empty">Connecting TV wallboard…</div></div>;
  if (connection === "error") return <div className="tv-display-page"><div className="tv-display-error"><strong>TV wallboard unavailable</strong><span>{connectionError}</span></div></div>;

  // OperationsWallboard owns its requests and receives the paired key explicitly.
  // This avoids any browser-global request interception while retaining TV-only auth.
  return <OperationsWallboard tvMode tvAccessKey={displayKey} />;
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
      storeDisplayKey(result.key);
      setDisplayKey(result.key);
      setPairCode("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The TV could not be paired.");
    } finally {
      setPairing(false);
    }
  }

  const resetPairing = useCallback(() => {
    clearDisplayKey();
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
