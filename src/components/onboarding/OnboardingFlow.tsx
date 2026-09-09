'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Loader2, Radar } from 'lucide-react';

// ---------------------------------------------------------------------------
// Three questions, one screen at a time: who you are, which organisation your
// outreach speaks for, and the SerpAPI key that will pay for searches. The key
// is verified against SerpAPI before it is stored, and the plan's remaining
// searches are shown — free accounts are small, so people rotate them.
// ---------------------------------------------------------------------------

interface Props {
  initialName: string;
  initialCompany: string;
  email: string | null;
}

type Step = 'name' | 'company' | 'key';
const ORDER: Step[] = ['name', 'company', 'key'];

export function OnboardingFlow({ initialName, initialCompany, email }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState(initialCompany);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<{ last4: string; searchesLeft?: number; planName?: string } | null>(null);

  const index = ORDER.indexOf(step);

  const save = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const next = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 'name') {
        if (name.trim().length < 2) throw new Error('Please enter your name.');
        await save({ name });
        setStep('company');
      } else if (step === 'company') {
        if (company.trim().length < 2) throw new Error('Please enter your company or organisation.');
        await save({ company });
        setStep('key');
      } else {
        const data = await save({ serpapi_key: key.trim() || undefined, complete: true });
        if (data.serpapi) setVerified(data.serpapi);
        router.replace('/dashboard');
        return;
      }
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await save({ serpapi_key: key.trim() });
      setVerified(data.serpapi ?? null);
    } catch (e: any) {
      setError(e?.message || 'Could not verify the key.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-[520px] flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-[5px] bg-ink text-white flex items-center justify-center">
              <Radar className="w-3.5 h-3.5" strokeWidth={2.5} />
            </span>
            <span className="text-label-sm">CandidateRadar</span>
          </div>
          <span className="text-body-xs text-mute tabular-nums">
            Step {index + 1} of {ORDER.length}
            {email ? ` · ${email}` : ''}
          </span>
        </div>

        {/* progress */}
        <div className="grid grid-cols-3 gap-1.5" aria-hidden>
          {ORDER.map((s, i) => (
            <span key={s} className={`h-1 rounded-full ${i <= index ? 'bg-ink' : 'bg-hairline'}`} />
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void next();
          }}
          className="card p-6 flex flex-col gap-5"
        >
          {step === 'name' && (
            <>
              <div>
                <span className="eyebrow">Question 1</span>
                <h1 className="text-heading-md mt-1">What should we call you?</h1>
                <p className="text-body-sm text-mute mt-1">Shown in the sidebar and recorded as the author of sessions and outreach.</p>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">Your name</span>
                <input autoFocus className="input input-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
              </label>
            </>
          )}

          {step === 'company' && (
            <>
              <div>
                <span className="eyebrow">Question 2</span>
                <h1 className="text-heading-md mt-1">Which organisation are you hiring for?</h1>
                <p className="text-body-sm text-mute mt-1">Outreach messages are written in this name. You can change it later in Settings.</p>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">Company or organisation</span>
                <input autoFocus className="input input-lg" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="House of EdTech" />
              </label>
            </>
          )}

          {step === 'key' && (
            <>
              <div>
                <span className="eyebrow">Question 3</span>
                <h1 className="text-heading-md mt-1">Your SerpAPI key</h1>
                <p className="text-body-sm text-mute mt-1">
                  Searches run through your SerpAPI account, one credit per results page. Free accounts include a limited number of searches per month; swap the key in
                  Settings any time you switch accounts.{' '}
                  <a href="https://serpapi.com/manage-api-key" target="_blank" rel="noreferrer" className="text-link hover:underline">
                    Get a key
                  </a>
                </p>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">SerpAPI key</span>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="password"
                    autoComplete="off"
                    className="input input-lg font-mono"
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setVerified(null);
                    }}
                    placeholder="64-character key"
                  />
                  <button type="button" onClick={() => void verify()} disabled={busy || key.trim().length < 8} className="btn-ghost btn-lg flex-shrink-0">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                  </button>
                </div>
              </label>
              {verified && (
                <div className="px-3 py-2 rounded-sm bg-canvas border border-hairline text-body-sm text-body flex items-center gap-2">
                  <Check className="w-4 h-4 text-ink" strokeWidth={2.5} />
                  <span>
                    Key ending in <span className="font-mono">{verified.last4}</span> works
                    {verified.planName ? ` · ${verified.planName}` : ''}
                    {typeof verified.searchesLeft === 'number' ? ` · ${verified.searchesLeft.toLocaleString()} searches left this month` : ''}.
                  </span>
                </div>
              )}
              <p className="text-body-xs text-mute">You can skip this and add the key in Settings, but searches will return nothing until one is on file.</p>
            </>
          )}

          {error && <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{error}</div>}

          <div className="flex items-center justify-between gap-2 pt-1">
            {index > 0 ? (
              <button type="button" onClick={() => setStep(ORDER[index - 1])} className="btn-ghost" disabled={busy}>
                Back
              </button>
            ) : (
              <span />
            )}
            <button type="submit" className="btn-primary btn-lg" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {step === 'key' ? (key.trim() ? 'Finish' : 'Skip for now') : 'Continue'}
              {!busy && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
