import { productionEngine } from '@production/index';
import { freeBrowserPocEngine } from '@pocs/free-browser-poc/engine';
import type { SearchEngineModule } from './searchEngine';

// ---------------------------------------------------------------------------
// Every engine that is wired up and selectable, keyed by its id. The engines
// themselves live in two root-level folders, outside src/:
//   /production/   — ships to users
//   /pocs/<name>/  — one complete, standalone proof of concept per folder
// This module is the only place that imports across that boundary; nothing
// else should import from @production/* or @pocs/* directly. serp.ts is the
// only caller of this registry: it decides the ORDER engines are tried in
// (production first, a POC as fallback), this module only decides what
// exists. See /pocs/README.md for how a new POC folder gets added here.
// ---------------------------------------------------------------------------

export const SEARCH_ENGINES: Record<string, SearchEngineModule> = {
  [productionEngine.id]: productionEngine,
  [freeBrowserPocEngine.id]: freeBrowserPocEngine,
};

export function listSearchEngines(): SearchEngineModule[] {
  return Object.values(SEARCH_ENGINES);
}

export function getSearchEngine(id: string): SearchEngineModule | undefined {
  return SEARCH_ENGINES[id];
}
