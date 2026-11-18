import { providerLabel } from './index';
import type { ProviderErrorKind, SearchProviderId } from './types';

// ---------------------------------------------------------------------------
// Run-level provider latch — shared by every query of one run (and every
// worker slot running them). Pure and Prisma-free so it can be tested alone.
//
// When a provider fails in a way no retry can fix (no credits, the plan's
// hourly cap, a rejected key), it is marked dead for the rest of the run:
//   * another provider with a key is left → the remaining queries use it;
//   * none is left → the run is halted: queries not yet started are recorded
//     as skipped with the reason, instead of each burning its own retries.
// ---------------------------------------------------------------------------

export interface DeadProvider {
  kind: ProviderErrorKind;
  message: string;
}

export interface ProviderRunState {
  /** The run's providers, in preference order. */
  readonly chain: readonly SearchProviderId[];
  readonly dead: Map<SearchProviderId, DeadProvider>;
  /** Set once every provider in the chain is dead: why the run stopped. */
  halted: { kind: ProviderErrorKind; message: string } | null;
  /** Recruiter-readable notes about provider switches, in order. */
  readonly events: string[];
}

export function createProviderRunState(chain: readonly SearchProviderId[], seed?: Partial<Record<SearchProviderId, DeadProvider>> | null): ProviderRunState {
  const state: ProviderRunState = { chain: [...chain], dead: new Map(), halted: null, events: [] };
  for (const id of chain) {
    const d = seed?.[id];
    if (d) state.dead.set(id, d);
  }
  if (chain.length > 0 && chain.every((id) => state.dead.has(id))) {
    const last = state.dead.get(chain[chain.length - 1])!;
    state.halted = { kind: last.kind, message: haltMessage(last.message, last.kind) };
  }
  return state;
}

export function aliveProviders(state: ProviderRunState): SearchProviderId[] {
  return state.chain.filter((id) => !state.dead.has(id));
}

export function isProviderDead(state: ProviderRunState, id: SearchProviderId): boolean {
  return state.dead.has(id);
}

/** What the recruiter is told when the run cannot continue. */
export function haltMessage(reason: string, kind: ProviderErrorKind): string {
  const next =
    kind === 'hourly_limit'
      ? 'Run the remaining queries again after the hour turns, or add another search key in Settings.'
      : kind === 'auth'
        ? 'Replace the key in Settings, then run the remaining queries again.'
        : 'Add searches to that account or another search key in Settings, then run the remaining queries again.';
  return `${reason.replace(/\s+$/, '').replace(/([^.])$/, '$1.')} Profiles found so far are saved. ${next}`;
}

/**
 * Marks a provider dead. Returns the provider the run switches to, or null
 * when nothing is left (the state is then halted). Idempotent: concurrent
 * queries hitting the same exhausted account report it once.
 */
export function markProviderDead(state: ProviderRunState, id: SearchProviderId, kind: ProviderErrorKind, message: string): { switchedTo: SearchProviderId | null; firstTime: boolean } {
  const firstTime = !state.dead.has(id);
  if (firstTime) state.dead.set(id, { kind, message });
  const alive = aliveProviders(state);
  if (alive.length === 0) {
    if (!state.halted) state.halted = { kind, message: haltMessage(message, kind) };
    return { switchedTo: null, firstTime };
  }
  if (firstTime) state.events.push(`${message.replace(/\.$/, '')} — switched to ${providerLabel(alive[0])} for the rest of the run.`);
  return { switchedTo: alive[0], firstTime };
}
