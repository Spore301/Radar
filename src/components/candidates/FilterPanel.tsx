'use client';

// ---------------------------------------------------------------------------
// Results filter bar: search, Location / Seniority / Company / Tier popovers,
// platform pills, sort, grid/list, removable chips for every active filter and
// a "Showing X of Y · Z hidden · Show all" line. State lives in
// useCandidateFilters; this file only renders it.
//
// Filters hide rows; they never delete them. The bar always says how many rows
// are hidden and offers a one-click "Show all".
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Search, LayoutGrid, List, ChevronDown, Check, X } from 'lucide-react';
import { PLATFORMS, platformLabel } from '@/lib/search/platforms';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';
import { TIER_BG, TIER_LABEL } from '@/lib/utils/tier';
import {
  SENIORITY_ORDER,
  SORT_OPTIONS,
  TIER_ORDER,
  TIER_RANGE,
  UNKNOWN_FACET,
  isSortKey,
  normaliseLocation,
  splitCityKey,
  type CountryCount,
} from '@/lib/filters/candidateFilters';
import type { CandidateFiltersController } from './useCandidateFilters';

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface FilterPanelProps {
  /** The controller returned by useCandidateFilters. */
  filters: CandidateFiltersController;
}

export function FilterPanel({ filters }: FilterPanelProps) {
  return <CandidateFilterBar filters={filters} />;
}

type PopoverId = 'location' | 'seniority' | 'company' | 'tier';

export function CandidateFilterBar({ filters: f }: FilterPanelProps) {
  const [openId, setOpenId] = useState<PopoverId | null>(null);
  const openChange = useCallback((id: PopoverId, open: boolean) => setOpenId((cur) => (open ? id : cur === id ? null : cur)), []);

  const loc = normaliseLocation(f.state.location);
  const shown = f.filtered.length;

  // Trigger summaries: the first selection, then "+N".
  const summarize = (items: string[]) => (items.length === 0 ? null : items.length === 1 ? items[0] : `${items[0]} +${items.length - 1}`);
  const withCities = new Set(loc.cities.map((k) => splitCityKey(k).country));
  const locationSummary = summarize([...loc.countries.filter((c) => !withCities.has(c)), ...loc.cities.map((k) => splitCityKey(k).city)]);
  const senioritySummary = summarize(f.state.seniority.map((v) => (v === UNKNOWN_FACET ? 'Not stated' : v)));
  const companyLabels = new Map(f.totals.companies.items.map((i) => [i.key, i.label]));
  const companySummary = summarize(f.state.companies.map((k) => (k === UNKNOWN_FACET ? 'Not stated' : companyLabels.get(k) ?? k)));
  const tierSummary = summarize(TIER_ORDER.filter((t) => f.state.tiers.includes(t)).map((t) => TIER_LABEL[t]));

  const noSeniorityEvidence = f.totals.seniority.levels.length === 0;
  const noCompanyEvidence = f.totals.companies.items.length === 0;

  return (
    <div className="flex flex-col gap-3" role="search" aria-label="Filter results">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-mute absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
          <input
            type="search"
            value={f.state.search}
            onChange={(e) => f.setSearch(e.target.value)}
            placeholder="Filter by name, skill or keyword…"
            aria-label="Filter by name, skill or keyword"
            className="input pl-8"
          />
        </div>

        <FilterPopover id="location" label="Location" summary={locationSummary} open={openId === 'location'} onOpenChange={openChange} width={320}>
          <LocationPanel f={f} />
        </FilterPopover>
        <FilterPopover id="seniority" label="Seniority" summary={senioritySummary} muted={noSeniorityEvidence} open={openId === 'seniority'} onOpenChange={openChange}>
          <SeniorityPanel f={f} />
        </FilterPopover>
        <FilterPopover id="company" label="Company" summary={companySummary} muted={noCompanyEvidence} open={openId === 'company'} onOpenChange={openChange} width={300}>
          <CompanyPanel f={f} />
        </FilterPopover>
        <FilterPopover id="tier" label="Tier" summary={tierSummary} open={openId === 'tier'} onOpenChange={openChange} width={260}>
          <TierPanel f={f} />
        </FilterPopover>

        <div className="flex items-center gap-2 ml-auto">
          <select value={f.state.sortBy} onChange={(e) => isSortKey(e.target.value) && f.setSortBy(e.target.value)} className="select w-auto" aria-label="Sort results">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label.toLowerCase()}
              </option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={f.viewMode === 'grid'} onClick={() => f.setViewMode('grid')} className="seg-item px-2.5" aria-label="Grid view">
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden />
            </button>
            <button type="button" aria-pressed={f.viewMode === 'list'} onClick={() => f.setViewMode('list')} className="seg-item px-2.5" aria-label="List view">
              <List className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <PlatformPills f={f} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-h-[22px]">
        {f.chips.length > 0 && (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {f.chips.map((chip) => (
              <li key={chip.id} className="chip text-ink pr-1 max-w-full">
                {chip.platform && <PlatformLogo platform={chip.platform} size={11} />}
                <span className="truncate max-w-[16rem]">{chip.label}</span>
                <button
                  type="button"
                  onClick={() => f.setState(chip.remove)}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-[3px] text-mute hover:text-ink hover:bg-hairline-soft"
                >
                  <X className="w-3 h-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-body-xs text-mute tabular-nums sm:ml-auto" aria-live="polite" aria-atomic="true">
          {f.hiddenCount > 0 ? (
            <>
              Showing <span className="text-ink font-medium">{shown}</span> of {f.total} · {f.hiddenCount} hidden by filters ·{' '}
              <button type="button" onClick={f.clearAll} className="text-ink font-medium hover:underline">
                Show all
              </button>
            </>
          ) : (
            <>Showing all {f.total}</>
          )}
          {!f.isDefault && !defaultsAreOpen(f) && (
            <>
              {' · '}
              <button type="button" onClick={f.reset} className="hover:underline hover:text-ink" title="Back to the filters this session opened with">
                Restore defaults
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** When the session defaults are "everything open", Show all already restores them. */
function defaultsAreOpen(f: CandidateFiltersController): boolean {
  const d = normaliseLocation(f.defaults.location);
  return d.mode === 'any' && !f.defaults.search && !f.defaults.platforms.length && !f.defaults.tiers.length && !f.defaults.seniority.length && !f.defaults.companies.length;
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface FilterPopoverProps {
  id: PopoverId;
  label: string;
  /** Short text of the active selection, shown in the trigger. */
  summary: string | null;
  /** Greyed trigger when the results carry no evidence for this facet (still opens, to say why). */
  muted?: boolean;
  open: boolean;
  onOpenChange: (id: PopoverId, open: boolean) => void;
  /** Preferred panel width in px; clamped to the viewport. */
  width?: number;
  children: React.ReactNode;
}

function FilterPopover({ id, label, summary, muted = false, open, onOpenChange, width = 280, children }: FilterPopoverProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [pos, setPos] = useState<{ left: number; width: number }>({ left: 0, width });

  const close = useCallback(
    (refocus: boolean) => {
      onOpenChange(id, false);
      if (refocus) triggerRef.current?.focus();
    },
    [id, onOpenChange]
  );

  // Keep the panel inside the viewport (16px gutter) wherever the trigger wrapped to.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const w = Math.min(width, vw - 32);
      const left = Math.min(Math.max(16, r.left), vw - 16 - w) - r.left;
      setPos({ left, width: w });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, width]);

  // Esc closes and returns focus to the trigger; a click outside closes.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('input, button:not([disabled])')?.focus();
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        // Tabbing out of the trigger + panel closes it (a click on blank panel space has no relatedTarget and keeps it open).
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(id, !open)}
        className={`btn-ghost max-w-[calc(100vw-32px)] ${summary ? 'bg-hairline-soft' : ''} ${muted && !summary ? 'text-mute' : ''}`}
      >
        <span>{label}</span>
        {summary && <span className="font-normal text-body truncate max-w-[10rem]">{summary}</span>}
        <ChevronDown className={`w-3.5 h-3.5 text-mute flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={`${label} filter`}
          className="absolute top-full mt-1.5 z-40 bg-elevated border border-hairline rounded-md shadow-float flex flex-col max-h-[min(70vh,520px)] overflow-hidden animate-fade-in"
          style={{ left: pos.left, width: pos.width }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel building blocks
// ---------------------------------------------------------------------------

function PanelHeader({ title, onClear }: { title: string; onClear?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-hairline flex-shrink-0">
      <span className="text-label-sm text-ink">{title}</span>
      {onClear && (
        <button type="button" onClick={onClear} className="btn-subtle btn-sm -mr-1.5">
          Clear
        </button>
      )}
    </div>
  );
}

function PanelBody({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col" role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-body-xs text-mute">{children}</p>;
}

function CheckMark({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`w-3.5 h-3.5 flex-shrink-0 rounded-[3px] border flex items-center justify-center ${on ? 'bg-ink border-ink text-white' : 'bg-elevated border-faint'}`}>
      {on && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
    </span>
  );
}

interface OptionRowProps {
  selected: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
  /** Nested under a parent row (cities inside a country). */
  indent?: boolean;
  leading?: React.ReactNode;
  title?: string;
}

function OptionRow({ selected, onClick, label, count, indent = false, leading, title }: OptionRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      title={title}
      className={`w-full flex-shrink-0 flex items-center gap-2 h-8 rounded-sm text-left text-body-sm hover:bg-hairline-soft focus-visible:outline-offset-[-2px] ${indent ? 'pl-7 pr-2' : 'px-2'} ${selected ? 'text-ink' : 'text-body'}`}
    >
      <CheckMark on={selected} />
      {leading}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="text-body-xs text-mute tabular-nums">{count}</span>
    </button>
  );
}

function MoreButton({ onClick, children, indent = false }: { onClick: () => void; children: React.ReactNode; indent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 h-7 rounded-sm text-left text-body-xs text-mute hover:text-ink hover:bg-hairline-soft focus-visible:outline-offset-[-2px] ${indent ? 'pl-7 pr-2' : 'px-2'}`}
    >
      {children}
    </button>
  );
}

function SwitchRow({ checked, onChange, disabled, label, count }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; count: number }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-2.5 h-8 text-left text-body-sm text-ink disabled:text-mute disabled:cursor-not-allowed"
    >
      <span aria-hidden className={`relative w-7 h-4 flex-shrink-0 rounded-pill border transition-colors ${checked && !disabled ? 'bg-ink border-ink' : 'bg-hairline-soft border-hairline'}`}>
        <span className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-elevated border border-hairline transition-[left] ${checked ? 'left-[13px]' : 'left-px'}`} />
      </span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="text-body-xs text-mute tabular-nums">{count}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

const TOP_COUNTRIES = 8;
const TOP_CITIES = 6;

function LocationPanel({ f }: { f: CandidateFiltersController }) {
  const [allCountries, setAllCountries] = useState(false);
  const loc = normaliseLocation(f.state.location);
  const counted = f.counts.location.countries;
  const byName = new Map(counted.map((c) => [c.country, c]));
  const selected = loc.countries.map((country) => byName.get(country) ?? { country, count: 0, cities: [], cityUnknown: 0 });
  const rest = counted.filter((c) => !loc.countries.includes(c.country));
  const list: CountryCount[] = [...selected, ...rest];
  const visible = allCountries ? list : list.slice(0, Math.max(TOP_COUNTRIES, selected.length));
  const unknown = f.unknownLocation;

  let help: string;
  if (loc.mode === 'any') {
    help = `${unknown.noLocation} of these results state no location. Pick a country to filter; unknown rows stay in unless you switch this off.`;
  } else {
    const parts = [`${unknown.noLocation} state no location`];
    for (const c of unknown.cityNotStated) parts.push(`${c.count} are in ${c.country} with no city stated`);
    help = `${parts.join('; ')}. Countries shown "from profile URL" come from LinkedIn's country subdomain; www.linkedin.com carries none.`;
  }

  return (
    <>
      <PanelHeader title="Location" onClear={loc.mode !== 'any' ? f.clearLocation : undefined} />
      <PanelBody label="Countries">
        {list.length === 0 && <PanelNote>None of these results states a country yet.</PanelNote>}
        {visible.map((c) => {
          const on = loc.countries.includes(c.country);
          return (
            <React.Fragment key={c.country}>
              <OptionRow selected={on} onClick={() => f.toggleCountry(c.country)} label={c.country} count={c.count} />
              {on && <CityList f={f} country={c} />}
            </React.Fragment>
          );
        })}
        {list.length > visible.length && <MoreButton onClick={() => setAllCountries(true)}>Show all {list.length} countries</MoreButton>}
      </PanelBody>
      <div className="border-t border-hairline px-3 py-2 flex flex-col gap-1 flex-shrink-0">
        <SwitchRow
          checked={loc.includeUnknown}
          disabled={loc.mode === 'any'}
          onChange={f.setIncludeUnknownLocation}
          label="Include unknown location"
          count={loc.mode === 'any' ? unknown.noLocation : unknown.total}
        />
        <p className="text-body-xs text-mute">{help}</p>
      </div>
    </>
  );
}

function CityList({ f, country }: { f: CandidateFiltersController; country: CountryCount }) {
  const [all, setAll] = useState(false);
  const loc = normaliseLocation(f.state.location);
  const selectedHere = loc.cities.map(splitCityKey).filter((k) => k.country === country.country).map((k) => k.city);
  const byCity = new Map(country.cities.map((c) => [c.city, c.count]));
  const list = [...selectedHere.map((city) => ({ city, count: byCity.get(city) ?? 0 })), ...country.cities.filter((c) => !selectedHere.includes(c.city))];
  const visible = all ? list : list.slice(0, Math.max(TOP_CITIES, selectedHere.length));

  return (
    <div role="group" aria-label={`Cities in ${country.country}`} className="flex flex-col">
      {visible.map((c) => (
        <OptionRow key={c.city} indent selected={selectedHere.includes(c.city)} onClick={() => f.toggleCity(country.country, c.city)} label={c.city} count={c.count} />
      ))}
      {list.length > visible.length && (
        <MoreButton indent onClick={() => setAll(true)}>
          Show {list.length - visible.length} more cities
        </MoreButton>
      )}
      {country.cityUnknown > 0 && (
        <p className="pl-7 pr-2 h-7 flex items-center gap-2 text-body-xs text-mute">
          <span className="flex-1 min-w-0 truncate">{list.length === 0 ? 'No city stated' : 'City not stated'}</span>
          <span className="tabular-nums">{country.cityUnknown}</span>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seniority / Company / Tier
// ---------------------------------------------------------------------------

function SeniorityPanel({ f }: { f: CandidateFiltersController }) {
  const sel = f.state.seniority;
  const counts = new Map(f.counts.seniority.levels.map((l) => [l.level, l.count]));
  const known = new Set(f.totals.seniority.levels.map((l) => l.level));
  const levels = SENIORITY_ORDER.filter((l) => known.has(l) || sel.includes(l));

  return (
    <>
      <PanelHeader title="Seniority" onClear={sel.length ? f.clearSeniority : undefined} />
      <PanelBody label="Seniority levels">
        {levels.length === 0 ? (
          <PanelNote>None of these {f.total} results names a seniority (Senior, Lead, Staff…) in its title or headline, so there is nothing to filter on yet.</PanelNote>
        ) : (
          <>
            {levels.map((l) => (
              <OptionRow key={l} selected={sel.includes(l)} onClick={() => f.toggleSeniority(l)} label={l} count={counts.get(l) ?? 0} />
            ))}
            <OptionRow selected={sel.includes(UNKNOWN_FACET)} onClick={() => f.toggleSeniority(UNKNOWN_FACET)} label={<span className="text-mute">Not stated</span>} count={f.counts.seniority.unknown} />
          </>
        )}
      </PanelBody>
    </>
  );
}

const TOP_COMPANIES = 10;
const MAX_COMPANY_MATCHES = 50;

function CompanyPanel({ f }: { f: CandidateFiltersController }) {
  const [query, setQuery] = useState('');
  const sel = f.state.companies;
  const labels = new Map(f.totals.companies.items.map((i) => [i.key, i.label]));
  const counted = f.counts.companies.items;
  const countBy = new Map(counted.map((i) => [i.key, i.count]));
  const selectedItems = sel.filter((k) => k !== UNKNOWN_FACET).map((key) => ({ key, label: labels.get(key) ?? key, count: countBy.get(key) ?? 0 }));
  const q = query.trim().toLowerCase();
  const pool = counted.filter((i) => !sel.includes(i.key));
  const rest = q ? pool.filter((i) => i.label.toLowerCase().includes(q)).slice(0, MAX_COMPANY_MATCHES) : pool.slice(0, TOP_COMPANIES);
  const hasEvidence = f.totals.companies.items.length > 0;

  return (
    <>
      <PanelHeader title="Company" onClear={sel.length ? f.clearCompanies : undefined} />
      {hasEvidence && (
        <div className="px-2 pt-2 flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-mute absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies…" aria-label="Search companies" className="input pl-8" />
          </div>
        </div>
      )}
      <PanelBody label="Current companies">
        {!hasEvidence ? (
          <PanelNote>None of these {f.total} results states a current company, so there is nothing to filter on yet.</PanelNote>
        ) : (
          <>
            {selectedItems.map((i) => (
              <OptionRow key={i.key} selected onClick={() => f.toggleCompany(i.key)} label={i.label} count={i.count} />
            ))}
            {rest.map((i) => (
              <OptionRow key={i.key} selected={false} onClick={() => f.toggleCompany(i.key)} label={i.label} count={i.count} />
            ))}
            {q && rest.length === 0 && <PanelNote>No company matches “{query.trim()}”.</PanelNote>}
            {!q && pool.length > rest.length && <PanelNote>Top {TOP_COMPANIES} of {pool.length + selectedItems.length} companies. Search to find the others.</PanelNote>}
            <OptionRow selected={sel.includes(UNKNOWN_FACET)} onClick={() => f.toggleCompany(UNKNOWN_FACET)} label={<span className="text-mute">Not stated</span>} count={f.counts.companies.unknown} />
          </>
        )}
      </PanelBody>
    </>
  );
}

function TierPanel({ f }: { f: CandidateFiltersController }) {
  const sel = f.state.tiers;
  return (
    <>
      <PanelHeader title="Match tier" onClear={sel.length ? f.clearTiers : undefined} />
      <PanelBody label="Match tiers">
        {TIER_ORDER.map((t) => (
          <OptionRow
            key={t}
            selected={sel.includes(t)}
            onClick={() => f.toggleTier(t)}
            leading={<span aria-hidden className={`w-2 h-2 rounded-[2px] flex-shrink-0 ${TIER_BG[t]}`} />}
            label={
              <>
                {TIER_LABEL[t]} <span className="text-mute">· {TIER_RANGE[t]}</span>
              </>
            }
            count={f.counts.tiers[t]}
          />
        ))}
      </PanelBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Platform pills (multi-select; "All" clears)
// ---------------------------------------------------------------------------

function PlatformPills({ f }: { f: CandidateFiltersController }) {
  const present = PLATFORMS.filter((p) => (f.totals.platforms[p.id] ?? 0) > 0 || f.state.platforms.includes(p.id));
  if (present.length === 0) return null;
  const allCount = Object.values(f.counts.platforms).reduce((s, n) => s + (n ?? 0), 0);
  return (
    <div className="seg overflow-x-auto no-scrollbar max-w-full self-start" role="group" aria-label="Platform">
      <button type="button" aria-pressed={f.state.platforms.length === 0} onClick={f.clearPlatforms} className="seg-item">
        All <span className="text-mute tabular-nums">{allCount}</span>
      </button>
      {present.map((p) => (
        <button key={p.id} type="button" aria-pressed={f.state.platforms.includes(p.id)} onClick={() => f.togglePlatform(p.id)} className="seg-item">
          <PlatformLogo platform={p.id} size={12} />
          {platformLabel(p.id)} <span className="text-mute tabular-nums">{f.counts.platforms[p.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
