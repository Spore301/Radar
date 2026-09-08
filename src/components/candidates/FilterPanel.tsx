'use client';

import React from 'react';
import { Search, LayoutGrid, List } from 'lucide-react';
import { CandidatePlatform } from '@/lib/types';
import { PLATFORMS } from '@/lib/search/platforms';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';

interface FilterPanelProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedPlatform: string;
  setSelectedPlatform: (platform: string) => void;
  selectedMatchTier: string;
  setSelectedMatchTier: (tier: string) => void;
  sortBy: string;
  setSortBy: (sort: string) => void;
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
  totalCount: number;
  filteredCount: number;
  /** Profiles per platform, so the pills can show counts and hide empty platforms. */
  platformCounts?: Partial<Record<CandidatePlatform, number>>;
}

export function FilterPanel({
  searchTerm,
  setSearchTerm,
  selectedPlatform,
  setSelectedPlatform,
  selectedMatchTier,
  setSelectedMatchTier,
  sortBy,
  setSortBy,
  viewMode,
  setViewMode,
  totalCount,
  filteredCount,
  platformCounts = {},
}: FilterPanelProps) {
  const platforms = PLATFORMS.filter((p) => (platformCounts[p.id] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-mute absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter by name, skill or keyword…"
            className="input pl-8"
          />
        </div>

        <select value={selectedMatchTier} onChange={(e) => setSelectedMatchTier(e.target.value)} className="select w-auto" aria-label="Match tier">
          <option value="All">All tiers</option>
          <option value="Strong">Strong · 70–100</option>
          <option value="Potential">Potential · 40–69</option>
          <option value="Low">Low · under 40</option>
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select w-auto" aria-label="Sort">
          <option value="score">Sort: relevance</option>
          <option value="name">Sort: name</option>
          <option value="date">Sort: discovered</option>
        </select>

        <div className="sm:ml-auto flex items-center gap-3">
          <span className="text-body-xs text-mute tabular-nums whitespace-nowrap">
            {filteredCount} of {totalCount}
          </span>
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} className="seg-item px-2.5" aria-label="Grid">
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} className="seg-item px-2.5" aria-label="List">
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="seg overflow-x-auto no-scrollbar max-w-full" role="group" aria-label="Platform">
        <button type="button" aria-pressed={selectedPlatform === 'All'} onClick={() => setSelectedPlatform('All')} className="seg-item">
          All <span className="text-mute tabular-nums">{totalCount}</span>
        </button>
        {platforms.map((p) => (
          <button key={p.id} type="button" aria-pressed={selectedPlatform === p.id} onClick={() => setSelectedPlatform(p.id)} className="seg-item">
            <PlatformLogo platform={p.id} size={12} />
            {p.label} <span className="text-mute tabular-nums">{platformCounts[p.id]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
