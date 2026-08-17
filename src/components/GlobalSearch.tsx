import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccessToken } from '../lib/auth';
import { intelligenceApi, type SearchResult } from '../lib/intelligenceApi';

export function GlobalSearch() {
  const token = useAccessToken();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const rows = await intelligenceApi.search(query.trim(), await token());
        setResults(rows); setOpen(true);
      } catch { setResults([]); }
    }, 220);
    return () => window.clearTimeout(timer.current);
  }, [query, token]);

  const choose = (item: SearchResult) => { setQuery(''); setOpen(false); navigate(item.href); };
  return <div className="global-search">
    <span className="global-search-icon">⌕</span>
    <input value={query} onChange={e => setQuery(e.target.value)} onFocus={() => results.length && setOpen(true)} placeholder="Search PO, run, reg, driver, customer, site…" aria-label="Search TMS" />
    {open && <div className="global-search-results">{results.length ? results.map(item => <button key={`${item.type}-${item.id}`} onClick={() => choose(item)}><b>{item.label}</b><span>{item.type} · {item.detail}</span></button>) : <div className="search-empty">No matching TMS records</div>}</div>}
  </div>;
}
