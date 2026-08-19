import { useEffect, useState } from 'react';
import { FuelMaster } from './Pages';
import { DriversUnified } from './DriversUnified';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { MasterDataAddPanel, type AddableMasterSection } from './MasterDataAddPanel';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices';

const sections: Array<{ key: MasterSection; label: string; detail: string }> = [
  { key: 'drivers', label: 'Drivers', detail: 'Full driver register including employee number, skills, code, Tacho details, driving licence and live hours' },
  { key: 'vehicles', label: 'Vehicles', detail: 'One canonical vehicle master: TMS planning identity plus joined Fleetio status, specification, maintenance, defects and work orders' },
  { key: 'trailers', label: 'Trailers', detail: 'One canonical trailer master: SLH trailer identity and capacity plus joined Fleetio C-number, specification, maintenance, defects and work orders' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs', detail: 'Vehicle fuel cards, PINs and fuel register' },
  { key: 'customers', label: 'Customers', detail: 'Customer names and master codes' },
  { key: 'sites', label: 'Sites', detail: 'One complete site register containing collection/delivery address and postcode, driver instructions, default temperature and planning region' },
  { key: 'geofences', label: 'Geofences', detail: 'RoadTech hit integrity, site links, dwell thresholds and entry/exit confirmation used by Live Runs' },
  { key: 'markets', label: 'Markets', detail: 'Market master records and contacts' },
  { key: 'fuel-prices', label: 'Fuel prices', detail: 'Fuel pricing reference data' },
];

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(initialSection);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { setSection(initialSection); setCleanupOpen(false); }, [initialSection]);

  const active = sections.find(item => item.key === section) || sections[0];
  const separateCleanup = section === 'drivers' || section === 'vehicles' || section === 'trailers';

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Live TMS master database</p>
        <h1>Master data</h1>
        <p className="intro">One place to add and maintain the records used throughout planning, tracking and integrations. The TMS is the live master; integrations enrich those same records rather than creating competing registers.</p>
      </div>
      <span className="status approved">Live TMS Master Database</span>
    </div>

    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => { setSection(item.key); setCleanupOpen(false); }}>{item.label}</button>)}
      </div>
      <p className="hint master-section-hint"><strong>{active.label}:</strong> {active.detail}</p>
    </div>

    <MasterDataAddPanel section={section as AddableMasterSection} onAdded={() => setRefreshKey(value => value + 1)} />

    <div key={`${section}-${refreshKey}`}>
      {section === 'drivers' && <DriversUnified />}
      {section === 'vehicles' && <FleetMasterUnified kind="vehicles" />}
      {section === 'trailers' && <FleetMasterUnified kind="trailers" />}
      {(section === 'customers' || section === 'sites') &&
        <MasterDataOperational initialTab={section} showCategoryButtons={false} showHeading={false} />}
      {section === 'geofences' && <GeofenceOperational />}
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
