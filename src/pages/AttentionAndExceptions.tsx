import { useState } from 'react';
import { Exceptions } from './Pages';
import { AttentionCentre } from './OperationsIntelligence';

export function AttentionAndExceptions() {
  const [view, setView] = useState<'attention' | 'exceptions'>('attention');

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Operations control</p>
        <h1>Needs attention</h1>
        <p className="intro">One place for operational issues, exceptions and items that need a planner or manager decision.</p>
      </div>
      <div className="actions">
        <button className={view === 'attention' ? 'primary' : undefined} onClick={() => setView('attention')}>Operational attention</button>
        <button className={view === 'exceptions' ? 'primary' : undefined} onClick={() => setView('exceptions')}>System exceptions</button>
      </div>
    </div>

    {view === 'attention' ? <AttentionCentre /> : <Exceptions />}
  </section>;
}
