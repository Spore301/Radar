import { productionEngine } from './production';
import { freeBrowserPocEngine } from './free-browser-poc/engine';
import type { SearchEngineModule } from './types';

// ---------------------------------------------------------------------------
// Every engine that is wired up and selectable, keyed by its id. A subfolder
// that exists only as a README (google-cse-poc, brave-api-poc — not yet
// implemented) has nothing to register here until it has an engine.ts.
// src/lib/search/serp.ts is the only caller: it decides the ORDER engines are
// tried in (production first, experimental as fallback), this module only
// decides what exists.
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
