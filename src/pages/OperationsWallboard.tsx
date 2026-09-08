import { useEffect } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";
import { RunGeofenceLinkagePanel } from "./RunGeofenceLinkagePanel";
import "../run-geofence-linkage.css";
import "../operations-wallboard-brand.css";
import "../operations-wallboard-kpi-compat.css";

function FirstCollectionTimeLabel() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".ops-board-row .time-cell:first-child small").forEach(label => {
        if (label.textContent?.trim().toLowerCase() === "planned start") label.textContent = "first collection";
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}

export function OperationsWallboard({ tvMode = false, tvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  return <>
    <FirstCollectionTimeLabel />
    {!tvMode && <RunGeofenceLinkagePanel />}
    <ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />
  </>;
}