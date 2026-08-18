import { useEffect, useState } from 'react';
import { FuelMaster } from './Pages';
import { DriversUnified } from './DriversUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { SitePlanningProfiles } from './SitePlanningProfiles';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices';

const sections: Array<{ key: MasterSection; label: string; detail: string }> = [
  { key: 'drivers', label: 'Drivers', detail: 'Full driver register including employee number, skills, code, Tacho details, driving licence and live hours' },
  { key: 'vehicles', label: 'Vehicles', detail: 'Registrations, fleet numbers, cab phones and vehicle identifiers' },
  { key: 'trailers', label: 'Trailers', detail: 'Canonical SLH trailer numbers, types and capacities' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs', detail: 'Vehicle fuel cards, PINs and fuel register' },
  { key: 'customers', label: 'Customers', detail: 'Customer names and master codes' },
  { key: 'sites', label: 'Sites', detail: 'Collection and delivery locations, driver instructions, default temperatures and planning regions' },
  { key: 'geofences', label: 'Geofences', detail: 'Operational site geofences, site links, dwell thresholds and entry/exit confirmation rules' },
  { key: 'markets', label: 'Markets', detail: 'Market master records and contacts' },
  { key: 'fuel-prices', label: 'Fuel prices', detail: 'Fuel pricing reference data' },
];

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(initialSection);

  useEffect(() => { setSection(initialSection); }, [initialSection]);

  const active = sections.find(item => item.key === section) || sections[0];

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Live TMS master database</p>
        <h1>Master data</h1>
        <p className="intro">One place to maintain the records used throughout planning, tracking and integrations. The TMS is the live master; legacy imports are migration tools only.</p>
      </div>
      <span className="status approved">Live TMS Master Database</span>
    </div>

    <div className="panel" style={{ marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8 }}>
        {sections.map(item => <button key={item.key} className={section === item.key ? 'primary' : ''} onClick={() => setSection(item.key)}>{item.label}</button>)}
      </div>
      <p className="hint" style={{ marginBottom: 0 }}><strong>{active.label}:</strong> {active.detail}</p>
    </div>

    {section === 'drivers' && <DriversUnified />}
    {(section === 'vehicles' || section === 'trailers' || section === 'customers' || section === 'sites' || section === 'geofences') &&
      <MasterDataOperational initialTab={section} showCategoryButtons={false} showHeading={false} />}
    {section === 'sites' && <SitePlanningProfiles />}
    {section === 'fuel-cards' && <FuelCardsOperational />}
    {section === 'markets' && <MarketsMasterClean />}
    {section === 'fuel-prices' && <FuelMaster />}
  </section>;
}
