import { useState } from 'react';
import { Exceptions } from './Pages';
import { AttentionCentre } from './OperationsIntelligence';

export function AttentionAndExceptions() {
  const [view, setView] = useState<'attention' | 'exceptions'>('attention');

  return <>
    <div className="planner-toolbar" style={{ marginBottom: 16 }}>
      <strong>Attention centre</strong>
      <div className="actions">
        <button className={view === 'attention' ? 'primary' : undefined} onClick={() => setView('attention')}>Operational attention</button>
        <button className={view === 'exceptions' ? 'primary' : undefined} onClick={() => setView('exceptions')}>System exceptions</button>
      </div>
    </div>
    {view === 'attention' ? <AttentionCentre /> : <Exceptions />}
  </>;
}
