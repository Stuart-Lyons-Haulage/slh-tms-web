import { useEffect } from "react";
import { OperationsWallboard as ExistingOperationsWallboard } from "./OperationsWallboardLive";
import { RunGeofenceLinkagePanel } from "./RunGeofenceLinkagePanel";
import { EtaLearningBridge } from "./EtaLearningBridge";
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

function CompletedExitEvidenceLabel() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".ops-board-row.final-arrived .progress-cell").forEach(cell => {
        const markers = cell.querySelectorAll(".ops-progress-marker");
        const departed = cell.querySelectorAll(".ops-progress-marker.done");
        const existing = cell.querySelector<HTMLElement>(".ops-progress-exit-evidence");
        if (markers.length > 0 && departed.length === markers.length) {
          if (!existing) {
            const label = document.createElement("small");
            label.className = "ops-progress-exit-evidence";
            label.textContent = `${departed.length} of ${markers.length} geofences exited`;
            cell.appendChild(label);
          } else {
            existing.textContent = `${departed.length} of ${markers.length} geofences exited`;
          }
        } else {
          existing?.remove();
        }
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return null;
}

export function OperationsWallboard({ tvMode = false, tvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  return <>
    <FirstCollectionTimeLabel />
    <CompletedExitEvidenceLabel />
    <EtaLearningBridge />
    {!tvMode && <RunGeofenceLinkagePanel />}
    <ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />
  </>;
}