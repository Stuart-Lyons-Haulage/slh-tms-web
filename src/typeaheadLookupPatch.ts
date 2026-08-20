import { api, type Driver, type Site, type Trailer, type Vehicle } from './lib/api';

declare global {
  interface Window {
    __slhTypeaheadLookupPatch?: boolean;
  }
}

type LookupKind = 'driver' | 'vehicle' | 'trailer' | 'site';
type LookupState = {
  kind: LookupKind;
  wrapper: HTMLDivElement;
  input: HTMLInputElement;
  panel: HTMLDivElement;
  activeIndex: number;
  open: boolean;
};

let latestDrivers: Driver[] = [];
let latestVehicles: Vehicle[] = [];
let latestTrailers: Trailer[] = [];
let latestSites: Site[] = [];
let frame: number | undefined;
const enhanced = new WeakMap<HTMLSelectElement, LookupState>();

const normalise = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const compact = (value: unknown) => normalise(value).replace(/[^a-z0-9]/g, '');

function lookupKind(select: HTMLSelectElement): LookupKind | undefined {
  const first = normalise(select.options[0]?.textContent);
  const label = normalise(select.closest('label')?.textContent);
  const candidates = `${first} ${label}`;

  if (/^(driver|select driver(?:…|\.\.\.)?)$/.test(first) || /\bdriver\b/.test(first)) return 'driver';
  if (/^(vehicle|select vehicle(?:…|\.\.\.)?)$/.test(first) || /\bvehicle\b/.test(first)) return 'vehicle';
  if (/^(trailer|select trailer(?:…|\.\.\.)?)$/.test(first) || /\btrailer\b/.test(first)) return 'trailer';
  if (/^(site|select site(?:…|\.\.\.)?|collection site|delivery site)$/.test(first) || /\b(site|collection site|delivery site)\b/.test(candidates) && first.includes('site')) return 'site';
  return undefined;
}

function resourceSearch(kind: LookupKind, value: string) {
  if (!value) return '';
  if (kind === 'driver') {
    const item = latestDrivers.find(row => row.id === value);
    return item ? [item.displayName, item.employeeNumber, item.tachoName, item.mobileNumber, item.driverType, item.driverGroup, item.skills, item.coding].filter(Boolean).join(' ') : '';
  }
  if (kind === 'vehicle') {
    const item = latestVehicles.find(row => row.id === value);
    return item ? [item.registration, item.fleetNumber, item.abbreviation, item.fleetioName, item.fleetioStatus].filter(Boolean).join(' ') : '';
  }
  if (kind === 'trailer') {
    const item = latestTrailers.find(row => row.id === value);
    return item ? [item.trailerNumber, item.type, item.notes].filter(Boolean).join(' ') : '';
  }
  const item = latestSites.find(row => row.id === value);
  return item ? [item.name, item.driverTextName, item.externalCode, item.aliases, item.collectionAddress].filter(Boolean).join(' ') : '';
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function visibleLabel(select: HTMLSelectElement) {
  const selected = select.selectedOptions[0];
  if (!selected || !select.value) return '';
  return selected.textContent?.trim() || '';
}

function optionsFor(select: HTMLSelectElement, state: LookupState) {
  const query = normalise(state.input.value);
  const selectedLabel = normalise(visibleLabel(select));
  const all = [...select.options].map(option => ({
    option,
    label: option.textContent?.trim() || '',
    haystack: normalise(`${option.textContent || ''} ${resourceSearch(state.kind, option.value)}`),
  }));

  if (!query || query === selectedLabel) return all;
  const needleCompact = compact(query);
  return all
    .filter(item => item.haystack.includes(query) || compact(item.haystack).includes(needleCompact))
    .sort((left, right) => {
      const leftLabel = normalise(left.label);
      const rightLabel = normalise(right.label);
      const leftStarts = leftLabel.startsWith(query) || compact(leftLabel).startsWith(needleCompact) ? 0 : 1;
      const rightStarts = rightLabel.startsWith(query) || compact(rightLabel).startsWith(needleCompact) ? 0 : 1;
      return leftStarts - rightStarts || left.label.localeCompare(right.label);
    });
}

function renderOptions(select: HTMLSelectElement, state: LookupState) {
  if (!state.open || document.activeElement !== state.input) {
    state.panel.hidden = true;
    return;
  }

  const rows = optionsFor(select, state).slice(0, 60);
  state.activeIndex = Math.min(state.activeIndex, Math.max(rows.length - 1, 0));
  state.panel.replaceChildren();
  state.panel.hidden = false;

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'slh-typeahead-empty';
    empty.textContent = 'No matching options';
    state.panel.appendChild(empty);
    return;
  }

  rows.forEach(({ option, label }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slh-typeahead-option';
    button.textContent = label || (option.value ? option.value : 'Clear selection');
    button.disabled = option.disabled;
    button.dataset.active = index === state.activeIndex ? 'true' : 'false';
    button.dataset.selected = option.value === select.value ? 'true' : 'false';
    button.addEventListener('mouseenter', () => {
      state.activeIndex = index;
      renderOptions(select, state);
    });
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (option.disabled) return;
      setNativeSelectValue(select, option.value);
      state.input.value = option.value ? (option.textContent?.trim() || '') : '';
      state.open = false;
      state.panel.hidden = true;
      state.input.focus();
      state.input.select();
    });
    state.panel.appendChild(button);
  });
}

function syncSelect(select: HTMLSelectElement, state: LookupState) {
  if (!select.isConnected) {
    state.wrapper.remove();
    return;
  }
  state.input.disabled = select.disabled;
  if (document.activeElement !== state.input || !state.open) state.input.value = visibleLabel(select);
  if (document.activeElement === state.input && state.open) renderOptions(select, state);
}

function enhanceSelect(select: HTMLSelectElement, kind: LookupKind) {
  if (enhanced.has(select) || select.multiple || select.size > 1) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'slh-typeahead';
  wrapper.dataset.lookupKind = kind;

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = `Type to find ${kind}…`;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', `Search ${kind}`);

  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'slh-typeahead-arrow';
  arrow.tabIndex = -1;
  arrow.setAttribute('aria-label', `Show ${kind} options`);
  arrow.textContent = '⌄';

  const panel = document.createElement('div');
  panel.className = 'slh-typeahead-panel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;

  const state: LookupState = { kind, wrapper, input, panel, activeIndex: 0, open: false };
  enhanced.set(select, state);

  select.insertAdjacentElement('beforebegin', wrapper);
  wrapper.append(input, arrow, panel);
  select.dataset.slhTypeaheadSource = 'true';
  select.classList.add('slh-typeahead-source');
  input.value = visibleLabel(select);
  input.disabled = select.disabled;

  const open = (selectText = false) => {
    if (input.disabled) return;
    state.open = true;
    state.activeIndex = 0;
    if (selectText) input.select();
    renderOptions(select, state);
  };

  input.addEventListener('focus', () => open(true));
  input.addEventListener('input', () => {
    state.open = true;
    state.activeIndex = 0;
    if (!input.value.trim() && select.options[0]?.value === '') setNativeSelectValue(select, '');
    renderOptions(select, state);
  });
  input.addEventListener('keydown', event => {
    const rows = optionsFor(select, state).slice(0, 60);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!state.open) open();
      else state.activeIndex = Math.min(state.activeIndex + 1, Math.max(rows.length - 1, 0));
      renderOptions(select, state);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.activeIndex = Math.max(state.activeIndex - 1, 0);
      renderOptions(select, state);
    } else if (event.key === 'Enter' && state.open && rows[state.activeIndex]) {
      event.preventDefault();
      const option = rows[state.activeIndex].option;
      if (!option.disabled) {
        setNativeSelectValue(select, option.value);
        input.value = option.value ? (option.textContent?.trim() || '') : '';
        state.open = false;
        panel.hidden = true;
      }
    } else if (event.key === 'Escape') {
      state.open = false;
      panel.hidden = true;
      input.value = visibleLabel(select);
    }
  });
  input.addEventListener('blur', () => window.setTimeout(() => {
    if (document.activeElement && wrapper.contains(document.activeElement)) return;
    state.open = false;
    panel.hidden = true;
    input.value = visibleLabel(select);
  }, 120));
  arrow.addEventListener('mousedown', event => event.preventDefault());
  arrow.addEventListener('click', () => {
    input.focus();
    if (state.open) {
      state.open = false;
      panel.hidden = true;
    } else open(false);
  });
  select.addEventListener('change', () => syncSelect(select, state));
}

function siteOptionLabel(site: Site) {
  const extra = [site.externalCode, site.driverTextName && site.driverTextName !== site.name ? site.driverTextName : undefined]
    .filter(Boolean).join(' · ');
  return extra ? `${site.name} · ${extra}` : site.name;
}

function syncSiteDatalist() {
  const id = 'slh-site-master-options';
  let list = document.getElementById(id) as HTMLDataListElement | null;
  if (!list) {
    list = document.createElement('datalist');
    list.id = id;
    document.body.appendChild(list);
  }
  const signature = latestSites.filter(site => site.active).map(site => `${site.id}:${site.name}:${site.externalCode}:${site.driverTextName || ''}:${site.aliases || ''}`).join('|');
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren();
  latestSites.filter(site => site.active).sort((a, b) => a.name.localeCompare(b.name)).forEach(site => {
    const canonical = document.createElement('option');
    canonical.value = site.name;
    canonical.label = siteOptionLabel(site);
    list!.appendChild(canonical);
    (site.aliases || '').split(/[,;|]/).map(alias => alias.trim()).filter(Boolean).forEach(alias => {
      const option = document.createElement('option');
      option.value = alias;
      option.label = `${alias} → ${site.name}`;
      list!.appendChild(option);
    });
  });
}

function enhanceSiteInputs() {
  document.querySelectorAll<HTMLInputElement>('.simple-run-line input').forEach(input => {
    const row = input.closest('.simple-run-line');
    if (!row || input.readOnly || input.disabled) return;
    const inputs = [...row.querySelectorAll<HTMLInputElement>('input')];
    const index = inputs.indexOf(input);
    if (index === 0 || index === 2) {
      input.setAttribute('list', 'slh-site-master-options');
      input.setAttribute('autocomplete', 'off');
    }
  });

  document.querySelectorAll<HTMLLabelElement>('label').forEach(label => {
    const text = normalise(label.childNodes[0]?.textContent || label.textContent);
    if (!/^(collection site|delivery site|destination)$/.test(text)) return;
    const input = label.querySelector<HTMLInputElement>('input:not([type="date"]):not([type="number"])');
    if (!input || input.readOnly || input.disabled) return;
    input.setAttribute('list', 'slh-site-master-options');
    input.setAttribute('autocomplete', 'off');
  });
}

function injectStyles() {
  if (document.getElementById('slh-typeahead-styles')) return;
  const style = document.createElement('style');
  style.id = 'slh-typeahead-styles';
  style.textContent = `
    .slh-typeahead-source{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;clip-path:inset(50%)!important}
    .slh-typeahead{position:relative;width:100%;min-width:0}
    .slh-typeahead>input{width:100%;padding-right:32px!important}
    .slh-typeahead-arrow{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:28px;height:28px;padding:0;border:0;background:transparent;color:#526774;font-size:18px;line-height:1;z-index:2}
    .slh-typeahead-panel{position:absolute;z-index:1200;left:0;right:0;top:calc(100% + 4px);max-height:260px;overflow:auto;background:#fff;border:1px solid #cbd5dc;border-radius:8px;padding:4px;box-shadow:0 12px 30px rgba(15,40,55,.18)}
    .slh-typeahead-option{display:block;width:100%;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;padding:8px 10px;cursor:pointer;font:inherit}
    .slh-typeahead-option[data-active="true"],.slh-typeahead-option[data-selected="true"]{background:#eef5f7}
    .slh-typeahead-option:disabled{opacity:.55;cursor:not-allowed}
    .slh-typeahead-empty{padding:9px 10px;color:#667784;font-size:.9rem}
  `;
  document.head.appendChild(style);
}

function applyEnhancements() {
  frame = undefined;
  injectStyles();
  syncSiteDatalist();
  enhanceSiteInputs();
  document.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
    const kind = lookupKind(select);
    if (!kind) return;
    enhanceSelect(select, kind);
    const state = enhanced.get(select);
    if (state) syncSelect(select, state);
  });
}

function queueEnhancements() {
  if (frame != null) return;
  frame = window.requestAnimationFrame(applyEnhancements);
}

if (typeof window !== 'undefined' && !window.__slhTypeaheadLookupPatch) {
  window.__slhTypeaheadLookupPatch = true;

  const originalDrivers = api.drivers;
  api.drivers = async token => {
    const result = await originalDrivers(token);
    latestDrivers = Array.isArray(result) ? result : [];
    queueEnhancements();
    return result;
  };

  const originalVehicles = api.vehicles;
  api.vehicles = async token => {
    const result = await originalVehicles(token);
    latestVehicles = Array.isArray(result) ? result : [];
    queueEnhancements();
    return result;
  };

  const originalTrailers = api.trailers;
  api.trailers = async token => {
    const result = await originalTrailers(token);
    latestTrailers = Array.isArray(result) ? result : [];
    queueEnhancements();
    return result;
  };

  const originalSites = api.sites;
  api.sites = async token => {
    const result = await originalSites(token);
    latestSites = Array.isArray(result) ? result : [];
    queueEnhancements();
    return result;
  };

  const observer = new MutationObserver(queueEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('change', queueEnhancements, true);
  window.addEventListener('focus', queueEnhancements);
  queueEnhancements();
}
