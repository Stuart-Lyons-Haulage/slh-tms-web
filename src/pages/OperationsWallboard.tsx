import { OperationsWallboard as ExistingOperationsWallboard } from './OperationsWallboardLive';
import { RunGeofenceLinkagePanel } from './RunGeofenceLinkagePanel';
import '../run-geofence-linkage.css';

export function OperationsWallboard({ tvMode = false, tvAccessKey }: { tvMode?: boolean; tvAccessKey?: string }) {
  return <>
    {!tvMode && <RunGeofenceLinkagePanel />}
    <ExistingOperationsWallboard tvMode={tvMode} tvAccessKey={tvAccessKey} />
  </>;
}
