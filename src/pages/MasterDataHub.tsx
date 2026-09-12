import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { FuelMaster } from './Pages';
import { DriversMasterCompact } from './DriversMasterCompact';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { DotGeofenceImport } from './DotGeofenceImport';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices';

const sections: Array<{ key: MasterSection; label: string; detail: string }> = [
  { key: 'drivers', label: 'Drivers', detail: 'Compact driver register for employee, contact, skills, coding and Tacho identity; click a driver to edit the full record and maintain documents' },
  { key: 'vehicles', label: 'Vehicles', detail: 'One canonical vehicle master: TMS planning identity plus joined Fleetio status, specification, maintenance, defects and work orders' },
  { key: 'trailers', label: 'Trailers', detail: 'One canonical trailer master: SLH trailer identity and capacity plus joined Fleetio C-number, specification, maintenance, defects and work orders' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs', detail: 'Vehicle fuel cards, PINs and fuel register' },
  { key: 'sites', label: 'Sites', detail: 'One canonical operational location register: site code, planner/driver wording, address, instructions, planning profile and all linked RoadTech geofences' },
  { key: 'markets', label: 'Markets', detail: 'Market master records and contacts' },
  { key: 'fuel-prices', label: 'Fuel prices', detail: 'Fuel pricing reference data' },
];

function canonicalSection(value: MasterSection): MasterSection {
  // Customers remain a commercial/order concept in the backend, and geofences remain
  // execution evidence, but neither should compete with Site Master as an operational
  // location register. Preserve old deep links by landing them in Sites.
  return value === 'customers' || value === 'geofences' ? 'sites' : value;
}

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(() => canonicalSection(initialSection));
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const token = useAccessToken();
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string>();

  useEffect(() => { setSection(canonicalSection(initialSection)); setCleanupOpen(false); }, [initialSection]);

  const active = sections.find(item => item.key === section) || sections[0];
  const separateCleanup = section === 'drivers' || section === 'vehicles' || section === 'trailers';

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Microsoft Lists CRM · TMS operational copy</p>
        <h1>Master data</h1>
        <p className="intro">Maintain drivers, sites, vehicles, trailers, markets and customer records in Microsoft Lists. This page is the fast operational copy used by planning and dispatch, refreshed hourly.</p>
      </div>
      <div>
        <span className="status approved">Lists-managed CRM</span>
        <button style={{ display: 'block', marginTop: 10 }} disabled={publishing} onClick={async () => {
          setPublishing(true); setPublishMessage(undefined);
          try {
            const result = await api.publishSharePointMasterData(await token());
            setPublishMessage(`${result.rowsWritten} master rows published to SharePoint Lists.`);
          } catch (error) {
            setPublishMessage(error instanceof Error ? error.message : 'SharePoint publish failed.');
          } finally { setPublishing(false); }
        }}>{publishing ? 'Publishing master data…' : 'Publish SQL master data to Lists'}</button>
        {publishMessage && <p className="hint" style={{ maxWidth: 280 }}>{publishMessage}</p>}
      </div>
    </div>


    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => { setSection(item.key); setCleanupOpen(false); }}>{item.label}</button>)}
      </div>
      <p className="hint master-section-hint"><strong>{active.label}:</strong> {active.detail}</p>
    </div>

    <div key={`${section}-${refreshKey}`}>
      {section === 'drivers' && <DriversMasterCompact />}
      {section === 'vehicles' && <FleetMasterUnified kind="vehicles" />}
      {section === 'trailers' && <FleetMasterUnified kind="trailers" />}
      {section === 'sites' && <>
        <DotGeofenceImport onImported={() => setRefreshKey(value => value + 1)} />
        <MasterDataOperational initialTab="sites" showCategoryButtons={false} showHeading={false} />
        <div className="panel" style={{ marginTop: 18, marginBottom: 18 }}>
          <p className="eyebrow">Site execution evidence</p>
          <h2>Geofences attached to Site Master</h2>
          <p className="hint">RoadTech polygons are execution children of the canonical Site record. A geofence may be linked to a Site, deliberately marked location-only, or left unassigned for reconciliation; it must never create a second competing site identity.</p>
        </div>
        <GeofenceOperational />
      </>}
      {section === 'fuel-cards' && <FuelCardsOperational />}
      {section === 'markets' && <MarketsMasterClean />}
      {section === 'fuel-prices' && <FuelMaster />}
    </div>

    {separateCleanup && <div className="panel" style={{ marginTop: 18, border: '2px solid #d5e0e4' }}>
      <div className="title-row">
        <div>
          <p className="eyebrow">Master cleanup</p>
          <h2>Duplicates & archived records</h2>
          <p className="hint">Use this when tidying duplicate {active.label.toLowerCase()}. Archive is reversible. An archived row gets a permanent Delete button only for cleanup; the API will refuse deletion if the record is used by TMS history.</p>
        </div>
        <button className={cleanupOpen ? '' : 'primary'} onClick={() => setCleanupOpen(value => !value)}>{cleanupOpen ? 'Close cleanup' : 'Clean up duplicates'}</button>
      </div>
      {cleanupOpen && <MasterDataOperational initialTab={section as MasterDataTab} showCategoryButtons={false} showHeading={false} />}
    </div>}
  </section>;
}
