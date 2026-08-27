import { NavLink } from 'react-router-dom';

export function MobileDock({ openMenu }: { openMenu: () => void }) {
  return <nav className="mobile-dock" aria-label="Mobile TMS navigation">
    <NavLink to="/dashboard"><span>⌂</span><small>Dashboard</small></NavLink>
    <NavLink to="/" end><span>▦</span><small>Planner</small></NavLink>
    <NavLink to="/planner-import"><span>⇧</span><small>Imports</small></NavLink>
    <NavLink to="/driver-dispatch"><span>☷</span><small>Dispatch</small></NavLink>
    <button type="button" onClick={openMenu}><span>☰</span><small>More</small></button>
  </nav>;
}