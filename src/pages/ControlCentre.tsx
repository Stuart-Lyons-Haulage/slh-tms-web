import { useState } from 'react';
import { Admin } from './Pages';
import { OperationsControlClean } from './OperationsControlClean';

export function ControlCentre() {
  const [view, setView] = useState<'operations' | 'admin'>('operations');

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Control & administration</p>
        <h1>Control centre</h1>
        <p className="intro">One place for live operational confidence, daily reconciliation, integrations, synchronisation and platform administration.</p>
      </div>
      <div className="actions">
        <button className={view === 'operations' ? 'primary' : undefined} onClick={() => setView('operations')}>Live operations</button>
        <button className={view === 'admin' ? 'primary' : undefined} onClick={() => setView('admin')}>Integrations & admin</button>
      </div>
    </div>

    {view === 'operations' ? <OperationsControlClean /> : <Admin />}
  </section>;
}
