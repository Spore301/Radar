'use client';

import React, { useState } from 'react';
import { X, Plus, AlertTriangle } from 'lucide-react';
import { StructuredJD, MergedConstraints, CandidatePlatform, SeniorityLevel } from '@/lib/types';
import { PLATFORMS } from '@/lib/search/platforms';
import { TEMPLATES_BY_PLATFORM, isSoftSkill } from '@/lib/search/xrayTemplates';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';

interface ConstraintsFormProps {
  structuredJD: StructuredJD;
  initialConstraints: MergedConstraints;
  onSubmit: (updatedConstraints: MergedConstraints) => void;
  isLoading: boolean;
}

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-h-8 px-2 py-1.5 bg-elevated border border-hairline rounded-sm focus-within:border-ink transition-colors">
      {values.map((v) => (
        <span key={v} className="chip text-ink">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="text-mute hover:text-ink">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : 'Add…'}
        className="flex-1 min-w-[120px] h-5 bg-transparent text-body-sm text-ink outline-none"
      />
      <button type="button" onClick={add} className="text-mute hover:text-ink" aria-label="Add">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ConstraintsForm({ structuredJD, initialConstraints, onSubmit, isLoading }: ConstraintsFormProps) {
  const [c, setC] = useState<MergedConstraints>(initialConstraints);

  const togglePlatform = (id: CandidatePlatform) =>
    setC((prev) => ({
      ...prev,
      selected_platforms: prev.selected_platforms.includes(id) ? prev.selected_platforms.filter((p) => p !== id) : [...prev.selected_platforms, id],
    }));

  const queryCount = c.selected_platforms.reduce((n, p) => n + TEMPLATES_BY_PLATFORM[p].length, 0);
  const lowSeniorityConfidence = structuredJD.confidence_scores.seniority < 0.7;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(c);
      }}
      className="card"
    >
      <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-label-sm text-ink">Search constraints</h2>
          <p className="text-body-sm text-mute mt-0.5">Extracted from the job description. Adjust anything before the queries are generated.</p>
        </div>
        <button type="submit" disabled={isLoading || c.selected_platforms.length === 0} className="btn-primary">
          Generate {queryCount} {queryCount === 1 ? 'query' : 'queries'}
        </button>
      </div>

      {structuredJD.extraction_warnings.length > 0 && (
        <div className="mx-5 mt-4 px-3 py-2.5 rounded-sm bg-warning-soft text-body-sm text-warning-deep flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <ul className="flex flex-col gap-0.5">
            {structuredJD.extraction_warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="p-5 flex flex-col gap-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Job title</span>
            <input className="input input-lg" value={c.job_title} onChange={(e) => setC({ ...c, job_title: e.target.value })} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label flex items-center justify-between">
              Seniority
              {lowSeniorityConfidence && (
                <span className="text-body-xs text-warning-deep font-normal">Low confidence · {Math.round(structuredJD.confidence_scores.seniority * 100)}%</span>
              )}
            </span>
            <select className="select input-lg" value={c.seniority} onChange={(e) => setC({ ...c, seniority: e.target.value as SeniorityLevel | 'Any' })}>
              <option value="Any">Any</option>
              <option value="Junior">Junior · 0–2 yrs</option>
              <option value="Mid">Mid · 2–5 yrs</option>
              <option value="Senior">Senior · 5–8 yrs</option>
              <option value="Staff">Staff · 8–12 yrs</option>
              <option value="Lead">Lead / Principal · 10+ yrs</option>
              <option value="Executive">Executive / Director</option>
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="field-label">Location</span>
            <div className="flex gap-2">
              <input className="input input-lg" value={c.location} onChange={(e) => setC({ ...c, location: e.target.value })} placeholder="City, Country" />
              <label className={`btn-ghost btn-lg cursor-pointer select-none flex-shrink-0 ${c.remote_eligible ? 'border-ink' : ''}`}>
                <input type="checkbox" className="sr-only" checked={c.remote_eligible} onChange={(e) => setC({ ...c, remote_eligible: e.target.checked })} />
                <span className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center ${c.remote_eligible ? 'bg-ink border-ink' : 'border-faint'}`}>
                  {c.remote_eligible && <span className="w-1.5 h-1.5 bg-white rounded-[1px]" />}
                </span>
                Remote OK
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="field-label flex justify-between">
              Experience
              <span className="text-mute font-normal tabular-nums">
                {c.years_of_experience.min} – {c.years_of_experience.max} yrs
              </span>
            </span>
            <div className="grid grid-cols-2 gap-3 h-10 items-center">
              <label className="flex items-center gap-2 text-body-xs text-mute">
                Min
                <input
                  type="range"
                  min={0}
                  max={15}
                  value={c.years_of_experience.min}
                  onChange={(e) =>
                    setC({ ...c, years_of_experience: { ...c.years_of_experience, min: Math.min(parseInt(e.target.value, 10), c.years_of_experience.max) } })
                  }
                  className="w-full accent-ink"
                />
              </label>
              <label className="flex items-center gap-2 text-body-xs text-mute">
                Max
                <input
                  type="range"
                  min={c.years_of_experience.min}
                  max={20}
                  value={c.years_of_experience.max}
                  onChange={(e) => setC({ ...c, years_of_experience: { ...c.years_of_experience, max: parseInt(e.target.value, 10) } })}
                  className="w-full accent-ink"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="field-label">Must-have skills</span>
          <TagInput values={c.must_have_skills} onChange={(v) => setC({ ...c, must_have_skills: v })} placeholder="Add a required skill and press Enter" />
          {(() => {
            const soft = c.must_have_skills.filter(isSoftSkill);
            const hard = c.must_have_skills.filter((sk) => !isSoftSkill(sk));
            if (soft.length === 0) return <p className="text-body-xs text-mute">The first three are AND'd into every query; each is OR'd with one common spelling.</p>;
            return (
              <p className={`text-body-xs ${hard.length === 0 ? 'text-warning-deep' : 'text-mute'}`}>
                {soft.join(', ')} {soft.length === 1 ? 'is a soft skill and is' : 'are soft skills and are'} kept for scoring but never searched.{' '}
                {hard.length === 0
                  ? 'No searchable skill remains: queries will anchor on the title and domain instead. Add tools, methods or a domain term (e.g. "Generative AI", "Python") to sharpen them.'
                  : `Queries will search ${hard.slice(0, 3).join(', ')}.`}
              </p>
            );
          })()}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="field-label">Nice-to-have skills</span>
          <TagInput values={c.nice_to_have_skills} onChange={(v) => setC({ ...c, nice_to_have_skills: v })} placeholder="Add a secondary skill" />
        </div>

        <div className="flex flex-col gap-2">
          <span className="field-label flex justify-between">
            Platforms
            <span className="text-mute font-normal tabular-nums">
              {c.selected_platforms.length} selected · {queryCount} query {queryCount === 1 ? 'type' : 'types'}
            </span>
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {PLATFORMS.map((p) => {
              const on = c.selected_platforms.includes(p.id);
              const n = TEMPLATES_BY_PLATFORM[p.id].length;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlatform(p.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-2.5 h-10 px-3 rounded-sm border text-left transition-colors bg-elevated ${on ? 'border-ink' : 'border-hairline hover:border-faint'}`}
                >
                  <PlatformLogo platform={p.id} size={14} />
                  <span className="text-body-sm text-ink truncate">{p.label}</span>
                  <span className="ml-auto text-body-xs text-mute tabular-nums whitespace-nowrap">
                    {n} {n === 1 ? 'type' : 'types'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card border-ink/40 bg-canvas p-4 flex flex-col gap-2">
          <label htmlFor="additional-details" className="field-label text-ink flex items-center justify-between">
            <span>Additional details</span>
            <span className="text-mute font-normal">Read first when queries are built</span>
          </label>
          <textarea
            id="additional-details"
            rows={5}
            className="textarea bg-elevated"
            value={c.additional_details ?? c.soft_constraints ?? ''}
            onChange={(e) => setC({ ...c, additional_details: e.target.value })}
            placeholder={
              'Tell the query builder what the JD leaves out. For example:\n' +
              '• Must have shipped a "design system" at a B2B SaaS company.\n' +
              '• No agencies, no freelancers, no students or interns.\n' +
              '• Title on profile should say Product Designer, not Graphic Designer.\n' +
              '• Exclude anyone currently at Acme or Globex.'
            }
          />
          <p className="text-body-xs text-mute">
            Quoted phrases and "must" statements become required terms in every query. "No / not / exclude / avoid" statements become exclusions. Title
            wording here overrides the extracted title.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4">
          <div />
          <label className="flex flex-col gap-1.5">
            <span className="field-label flex justify-between">
              Results cap <span className="text-mute font-normal tabular-nums">{c.results_cap}</span>
            </span>
            <div className="h-10 flex items-center">
              <input type="range" min={10} max={100} step={10} value={c.results_cap} onChange={(e) => setC({ ...c, results_cap: parseInt(e.target.value, 10) })} className="w-full accent-ink" />
            </div>
          </label>
        </div>
      </div>
    </form>
  );
}
