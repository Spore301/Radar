import type { CandidateProfile } from '../types';
import { scoreTier, TIER_LABEL } from '../utils/tier';
import { platformLabel } from '../search/platforms';
import { stageLabel } from '../pipeline/stages';

// ---------------------------------------------------------------------------
// Lead export — one session's candidates as a CSV a recruiter can open in
// Sheets / Excel or import into an ATS. Pure and isomorphic.
//
// Every value here came from the open web (a search-result title or snippet),
// so a cell is never allowed to start with a spreadsheet formula trigger:
// "=HYPERLINK(...)" in a scraped headline would otherwise run when the file is
// opened. Such cells are prefixed with an apostrophe, which Excel and Sheets
// both treat as "text".
//
// Contact columns are what the index actually holds — the profile link the
// person published. RADR. never harvests personal emails or phone numbers.
// ---------------------------------------------------------------------------

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : String(value);
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isoDate = (v?: string | null) => (v ? v.slice(0, 10) : '');

interface Column {
  header: string;
  value: (c: CandidateProfile) => unknown;
}

const COLUMNS: Column[] = [
  { header: 'Name', value: (c) => c.name },
  { header: 'Headline', value: (c) => c.headline },
  { header: 'Platform', value: (c) => platformLabel(c.platform) },
  { header: 'Profile URL', value: (c) => c.profile_url },
  { header: 'LinkedIn URL', value: (c) => (c.platform === 'LinkedIn' ? c.profile_url : '') },
  { header: 'Location', value: (c) => c.location },
  { header: 'Match score', value: (c) => c.match_score },
  { header: 'Match tier', value: (c) => TIER_LABEL[scoreTier(c.match_score)] },
  { header: 'Organisation match', value: (c) => c.organization_match ?? '' },
  { header: 'Skills found', value: (c) => c.skills_detected },
  { header: 'Est. years of experience', value: (c) => c.experience_years_estimated ?? '' },
  { header: 'Pipeline stage', value: (c) => stageLabel(c.status) },
  { header: 'Outreach channel', value: (c) => c.outreach_channel ?? '' },
  { header: 'Last outreach', value: (c) => isoDate(c.outreach_date) },
  { header: 'Next follow-up', value: (c) => isoDate(c.next_follow_up) },
  { header: 'Notes', value: (c) => c.notes ?? '' },
  { header: 'Tags', value: (c) => c.tags ?? [] },
  { header: 'Profile snippet', value: (c) => c.summary_snippet },
  { header: 'Why it matched', value: (c) => c.match_rationale },
  { header: 'Gaps', value: (c) => c.missing_signals },
  { header: 'Discovered', value: (c) => isoDate(c.discovered_at) },
];

/**
 * The CSV text, CRLF line endings (RFC 4180), with a UTF-8 byte-order mark so
 * Excel reads names like "Bhattachārya" correctly instead of as mojibake.
 */
export function leadsToCsv(candidates: CandidateProfile[]): string {
  const lines = [COLUMNS.map((col) => csvCell(col.header)).join(',')];
  for (const c of candidates) lines.push(COLUMNS.map((col) => csvCell(col.value(c))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** "senior-backend-engineer-bengaluru-2026-10-29.csv" */
export function exportFileName(title: string, now = new Date()): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'leads';
  return `${slug}-${now.toISOString().slice(0, 10)}.csv`;
}
