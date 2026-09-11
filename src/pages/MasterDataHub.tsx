import { useEffect, useState } from 'react';
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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { setSection(canonicalSection(initialSection)); }, [initialSection]);

  const active = sections.find(item => item.key === section) || sections[0];
  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Live TMS master database</p>
        <h1>Master data</h1>
        <p className="intro">Operational master data is now maintained in the approved SharePoint Lists and synchronised into SQL. This screen is retained for operational lookup and verification while the transition completes.</p>
      </div>
      <span className="status approved">Live TMS Master Database</span>
    </div>


    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => { setSection(item.key); setCleanupOpen(false); }}>{item.label}</button>)}
      </div>
      <p className="hint master-section-hint"><strong>{active.label}:</strong> {active.detail}</p>
    </div>

    <div className="notice inline-notice">To change master data, use the approved SharePoint Lists. TMS route, run and dispatch records remain SQL-backed.</div>

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

  </section>;
}
