'use client';

// ---------------------------------------------------------------------------
// useCandidateFilters — owns the results-filter state for one session.
//
// - Resets to the session's defaults (defaultFiltersFor) whenever the session
//   or its location / remote setting changes. Sort is kept: it is a viewing
//   preference, not a filter.
// - Persists the last-used view mode and sort in localStorage (every access
//   guarded: storage can throw or be empty).
// - Never drops a candidate: `filtered` is a view, and `hiddenCount` says how
//   many rows the current filters hide.
// ---------------------------------------------------------------------------

import { useCallback, useDeferredValue, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CandidatePlatform, CandidateProfile, MergedConstraints } from '@/lib/types';
import type { Tier } from '@/lib/utils/tier';
import {
  type CandidateFilterState,
  type FacetCounts,
  type SeniorityFilterValue,
  type SortKey,
  activeFilterChips,
  clearCities as clearCitiesIn,
  clearLocation as clearLocationIn,
  defaultFiltersFor,
  filtersEqual,
  indexCandidates,
  isOpen,
  isSortKey,
  openFilters,
  runCandidateFilters,
  setIncludeUnknownLocation as setIncludeUnknownIn,
  setSearch as setSearchIn,
  toggleCity as toggleCityIn,
  toggleCompany as toggleCompanyIn,
  toggleCountry as toggleCountryIn,
  togglePlatform as togglePlatformIn,
  toggleSeniority as toggleSeniorityIn,
  toggleTier as toggleTierIn,
  unknownLocationCount,
  type ActiveFilterChip,
} from '@/lib/filters/candidateFilters';
import { platformLabel } from '@/lib/search/platforms';

export type ViewMode = 'grid' | 'list';

const VIEW_KEY = 'radr.results.viewMode';
const SORT_KEY = 'radr.results.sortBy';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode, quota, blocked storage: the preference just isn't remembered.
  }
}

export interface CandidateFiltersController {
  state: CandidateFilterState;
  setState: Dispatch<SetStateAction<CandidateFilterState>>;
  /** The session's starting filters (location preset, everything else open). */
  defaults: CandidateFilterState;

  /** Visible candidates, sorted. */
  filtered: CandidateProfile[];
  /** Every candidate, regardless of filters. */
  total: number;
  /** Rows the current filters hide (total - filtered.length). */
  hiddenCount: number;
  /** Contextual counts: each group counted over rows passing every other filter. */
  counts: FacetCounts;
  /** Counts over every candidate, ignoring filters. */
  totals: FacetCounts;
  /** Rows the "Include unknown location" toggle flips under the current location filter. */
  unknownLocation: ReturnType<typeof unknownLocationCount>;
  /** One removable chip per active filter value. */
  chips: ActiveFilterChip[];

  /** Filters equal the session defaults (sort ignored). */
  isDefault: boolean;
  /** No filter is active: every row shows. */
  isOpen: boolean;
  /** Back to the session defaults (keeps sort). */
  reset: () => void;
  /** Clears every filter so all rows show (keeps sort). The one-click "Show all". */
  clearAll: () => void;
  /** Clears the platform and tier filters, e.g. when a new run lands. */
  resetPlatformAndTier: () => void;

  setSearch: (text: string) => void;
  togglePlatform: (p: CandidatePlatform) => void;
  clearPlatforms: () => void;
  toggleTier: (t: Tier) => void;
  clearTiers: () => void;
  toggleCountry: (country: string) => void;
  toggleCity: (country: string, city: string) => void;
  clearCities: (country: string) => void;
  setIncludeUnknownLocation: (include: boolean) => void;
  clearLocation: () => void;
  toggleSeniority: (v: SeniorityFilterValue) => void;
  clearSeniority: () => void;
  toggleCompany: (key: string) => void;
  clearCompanies: () => void;
  setSortBy: (sort: SortKey) => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

/**
 * @param candidates every stored candidate for the session (never pre-filtered)
 * @param constraints the session's merged constraints, or null before they load
 * @param sessionKey the session id (or any key that changes when the session does)
 */
export function useCandidateFilters(candidates: CandidateProfile[], constraints: MergedConstraints | null, sessionKey: string | null): CandidateFiltersController {
  const location = constraints?.location ?? '';
  const remote = constraints ? Boolean(constraints.remote_eligible) : null;
  const defaults = useMemo(() => (remote === null ? defaultFiltersFor(null) : defaultFiltersFor({ location, remote_eligible: remote })), [location, remote]);

  const [state, setState] = useState<CandidateFilterState>(defaults);
  const [viewMode, setViewModeState] = useState<ViewMode>('grid');
  const [hydrated, setHydrated] = useState(false);

  // Reset when the session (or its location setting) changes. Done during
  // render, React's pattern for state derived from props, so the list never
  // paints one frame with the previous session's filters. Constraints arrive
  // after the session id, so the key includes them.
  const defaultsKey = `${sessionKey ?? ''}\u0001${remote === null ? '-' : remote ? 'remote' : 'onsite'}\u0001${location}`;
  const [appliedKey, setAppliedKey] = useState(defaultsKey);
  if (appliedKey !== defaultsKey) {
    setAppliedKey(defaultsKey);
    setState((s) => ({ ...defaults, sortBy: s.sortBy }));
  }

  // Load remembered preferences after mount (not during render: the server
  // render has no storage, and reading it early would mismatch hydration).
  useEffect(() => {
    const v = readStorage(VIEW_KEY);
    if (v === 'grid' || v === 'list') setViewModeState(v);
    const s = readStorage(SORT_KEY);
    if (isSortKey(s)) setState((st) => ({ ...st, sortBy: s }));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) writeStorage(SORT_KEY, state.sortBy);
  }, [hydrated, state.sortBy]);
  useEffect(() => {
    if (hydrated) writeStorage(VIEW_KEY, viewMode);
  }, [hydrated, viewMode]);

  // Typing stays responsive on 2,000 rows: the list follows a deferred copy of
  // the search text only, so a session switch or a click applies at once.
  const deferredSearch = useDeferredValue(state.search);
  const effective = useMemo(() => (deferredSearch === state.search ? state : { ...state, search: deferredSearch }), [state, deferredSearch]);
  const indexed = useMemo(() => indexCandidates(candidates), [candidates]);
  const run = useMemo(() => runCandidateFilters(indexed, effective), [indexed, effective]);

  const companyLabels = useMemo(() => new Map(run.totals.companies.items.map((i) => [i.key, i.label])), [run.totals]);
  const chips = useMemo(() => activeFilterChips(state, platformLabel, companyLabels), [state, companyLabels]);
  const unknownLocation = useMemo(() => unknownLocationCount(run.counts, state.location), [run.counts, state.location]);

  const update = useCallback((fn: (s: CandidateFilterState) => CandidateFilterState) => setState(fn), []);

  return {
    state,
    setState,
    defaults,
    filtered: run.filtered,
    total: candidates.length,
    hiddenCount: candidates.length - run.filtered.length,
    counts: run.counts,
    totals: run.totals,
    unknownLocation,
    chips,
    isDefault: filtersEqual(state, defaults),
    isOpen: isOpen(state),
    reset: useCallback(() => setState((s) => ({ ...defaults, sortBy: s.sortBy })), [defaults]),
    clearAll: useCallback(() => setState((s) => openFilters(s.sortBy)), []),
    resetPlatformAndTier: useCallback(() => setState((s) => ({ ...s, platforms: [], tiers: [] })), []),

    setSearch: useCallback((text: string) => update((s) => setSearchIn(s, text)), [update]),
    togglePlatform: useCallback((p: CandidatePlatform) => update((s) => togglePlatformIn(s, p)), [update]),
    clearPlatforms: useCallback(() => update((s) => ({ ...s, platforms: [] })), [update]),
    toggleTier: useCallback((t: Tier) => update((s) => toggleTierIn(s, t)), [update]),
    clearTiers: useCallback(() => update((s) => ({ ...s, tiers: [] })), [update]),
    toggleCountry: useCallback((country: string) => update((s) => toggleCountryIn(s, country)), [update]),
    toggleCity: useCallback((country: string, city: string) => update((s) => toggleCityIn(s, country, city)), [update]),
    clearCities: useCallback((country: string) => update((s) => clearCitiesIn(s, country)), [update]),
    setIncludeUnknownLocation: useCallback((include: boolean) => update((s) => setIncludeUnknownIn(s, include)), [update]),
    clearLocation: useCallback(() => update(clearLocationIn), [update]),
    toggleSeniority: useCallback((v: SeniorityFilterValue) => update((s) => toggleSeniorityIn(s, v)), [update]),
    clearSeniority: useCallback(() => update((s) => ({ ...s, seniority: [] })), [update]),
    toggleCompany: useCallback((key: string) => update((s) => toggleCompanyIn(s, key)), [update]),
    clearCompanies: useCallback(() => update((s) => ({ ...s, companies: [] })), [update]),
    setSortBy: useCallback((sort: SortKey) => update((s) => ({ ...s, sortBy: sort })), [update]),

    viewMode,
    setViewMode: setViewModeState,
  };
}
