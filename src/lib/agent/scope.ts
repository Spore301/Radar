import { isSoftSkill } from '../search/xrayTemplates';
import { platformLabel } from '../search/platforms';
import type { MergedConstraints } from '../types';
import type { AgentField, AgentPhase, AgentState, ScopeItem } from './types';

// ---------------------------------------------------------------------------
// Scope rules — pure and browser-safe. The engine uses them to decide the
// phase; the chat panel uses them to draw the checklist. One definition of
// "full scope" so the two never disagree.
// ---------------------------------------------------------------------------

export const GUARDRAIL = 'Searches are expensive. I shall not initiate query creation until I have the full scope of the recruitment.';

export const EMPTY_STATE: AgentState = { askedFields: [], coveredFields: [], confirmed: false, phase: 'gathering' };

/** Required fields still missing — nothing can be searched without these. */
export function missingFields(c: MergedConstraints): AgentField[] {
  const missing: AgentField[] = [];
  if (!c.job_title.trim()) missing.push('job_title');
  if (!c.location.trim() && !c.remote_eligible) missing.push('location');
  if (c.must_have_skills.filter((s) => !isSoftSkill(s)).length === 0 && c.domain.length === 0) missing.push('must_have_skills');
  return missing;
}

/** Extended scope not yet covered — present in the constraints, or asked-and-answered. */
export function uncoveredScope(c: MergedConstraints, state: AgentState): AgentField[] {
  const covered = new Set(state.coveredFields);
  const out: AgentField[] = [];
  if (c.seniority === 'Any' && !covered.has('seniority')) out.push('seniority');
  if (c.years_of_experience.min === 0 && c.years_of_experience.max === 10 && !covered.has('years_of_experience') && c.seniority === 'Any') out.push('years_of_experience');
  if (c.domain.length === 0 && !covered.has('domain')) out.push('domain');
  if (!c.additional_details?.trim() && !covered.has('additional_details')) out.push('additional_details');
  if (!covered.has('selected_platforms')) out.push('selected_platforms');
  return out;
}

export function buildScope(c: MergedConstraints, state: AgentState): ScopeItem[] {
  const covered = new Set(state.coveredFields);
  const yrs = c.years_of_experience;
  return [
    { field: 'job_title', label: 'Job title', state: c.job_title ? 'done' : 'pending', value: c.job_title || undefined },
    { field: 'location', label: 'Location', state: c.location || c.remote_eligible ? 'done' : 'pending', value: [c.location, c.remote_eligible ? 'Remote OK' : null].filter(Boolean).join(' · ') || undefined },
    {
      field: 'must_have_skills',
      label: 'Must-have skills or domain',
      state: c.must_have_skills.filter((s) => !isSoftSkill(s)).length || c.domain.length ? 'done' : 'pending',
      value: c.must_have_skills.length ? c.must_have_skills.join(', ') : c.domain.join(', ') || undefined,
    },
    { field: 'seniority', label: 'Seniority', state: c.seniority !== 'Any' || covered.has('seniority') ? 'done' : 'pending', value: c.seniority !== 'Any' ? c.seniority : covered.has('seniority') ? 'Any' : undefined },
    { field: 'years_of_experience', label: 'Experience', state: !(yrs.min === 0 && yrs.max === 10) || covered.has('years_of_experience') || c.seniority !== 'Any' ? 'done' : 'optional', value: !(yrs.min === 0 && yrs.max === 10) ? `${yrs.min}–${yrs.max} yrs` : covered.has('years_of_experience') ? 'any' : c.seniority !== 'Any' ? `implied by ${c.seniority}` : undefined },
    { field: 'domain', label: 'Domain / industry', state: c.domain.length || covered.has('domain') ? 'done' : 'pending', value: c.domain.join(', ') || (covered.has('domain') ? 'none' : undefined) },
    { field: 'additional_details', label: 'Must-mention & exclusions', state: c.additional_details?.trim() || covered.has('additional_details') ? 'done' : 'pending', value: c.additional_details?.trim() || (covered.has('additional_details') ? 'none' : undefined) },
    { field: 'selected_platforms', label: 'Platforms', state: covered.has('selected_platforms') ? 'done' : 'pending', value: c.selected_platforms.map(platformLabel).join(', ') || undefined },
    { field: 'confirmation', label: 'Go-ahead to build queries', state: state.confirmed ? 'done' : 'pending', value: state.confirmed ? 'confirmed' : undefined },
  ];
}



export function decidePhase(c: MergedConstraints, state: AgentState): AgentPhase {
  if (missingFields(c).length) return 'gathering';
  if (uncoveredScope(c, state).length) return 'scoping';
  return state.confirmed ? 'ready' : 'confirming';
}
