'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

interface KeySummary {
  configured: boolean;
  last4: string | null;
  verifiedAt: string | null;
}

interface Profile {
  name: string | null;
  email: string | null;
  company: string | null;
  serpapi: KeySummary;
  serper?: KeySummary;
}

type SearchProvider = 'serpapi' | 'serper';

async function patchMe(body: Record<string, unknown>) {
  const res = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data as {
    profile: Profile;
    serpapi?: { last4: string; searchesLeft?: number; planName?: string };
    serper?: { last4: string; balance?: number };
  };
}

const PROVIDERS: Record<
  SearchProvider,
  { label: string; field: 'serpapi_key' | 'serper_key'; blurb: string; href: string; hrefLabel: string; placeholder: string }
> = {
  serper: {
    label: 'Serper',
    field: 'serper_key',
    blurb: 'Google results in 1–2 seconds; each results page costs one credit. New accounts include free queries.',
    href: 'https://serper.dev/api-key',
    hrefLabel: 'Get a key',
    placeholder: 'Paste a Serper key',
  },
  serpapi: {
    label: 'SerpAPI',
    field: 'serpapi_key',
    blurb: 'Every results page costs one credit from this account. Free accounts are small — swap the key here when you switch accounts.',
    href: 'https://serpapi.com/manage-api-key',
    hrefLabel: 'Manage keys',
    placeholder: 'Paste a SerpAPI key',
  },
};

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [keyInput, setKeyInput] = useState<Record<SearchProvider, string>>({ serpapi: '', serper: '' });
  const [deepseekKey, setDeepseekKey] = useState('');
  const [busy, setBusy] = useState<'profile' | `save-${SearchProvider}` | `remove-${SearchProvider}` | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.profile) {
          setProfile(d.profile);
          setName(d.profile.name ?? '');
          setCompany(d.profile.company ?? '');
        }
      })
      .catch(() => setNotice({ tone: 'error', text: 'Could not load your profile.' }));
    try {
      setDeepseekKey(localStorage.getItem('DEEPSEEK_API_KEY') ?? '');
    } catch {
      // storage blocked
    }
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    setNotice(null);
    try {
      const d = await patchMe({ name, company });
      setProfile(d.profile);
      try {
        localStorage.setItem('DEEPSEEK_API_KEY', deepseekKey.trim());
      } catch {
        // ignore
      }
      setNotice({ tone: 'ok', text: 'Profile saved.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not save.' });
    } finally {
      setBusy(null);
    }
  };

  const keySummary = (p: SearchProvider): KeySummary | undefined => (p === 'serpapi' ? profile?.serpapi : profile?.serper);
  const otherConfigured = (p: SearchProvider) => Boolean(keySummary(p === 'serpapi' ? 'serper' : 'serpapi')?.configured);

  const saveKey = async (p: SearchProvider, e: React.FormEvent) => {
    e.preventDefault();
    setBusy(`save-${p}`);
    setNotice(null);
    try {
      const d = await patchMe({ [PROVIDERS[p].field]: keyInput[p].trim() });
      setProfile(d.profile);
      setKeyInput((k) => ({ ...k, [p]: '' }));
      if (p === 'serpapi') {
        const s = d.serpapi;
        setNotice({
          tone: 'ok',
          text: `SerpAPI key ending ${s?.last4 ?? '…'} verified and saved${s?.planName ? ` · ${s.planName}` : ''}${
            typeof s?.searchesLeft === 'number' ? ` · ${s.searchesLeft.toLocaleString()} searches left this month` : ''
          }.`,
        });
      } else {
        const s = d.serper;
        setNotice({
          tone: 'ok',
          text: `Serper key ending ${s?.last4 ?? '…'} verified and saved${typeof s?.balance === 'number' ? ` · ${s.balance.toLocaleString()} credits left` : ''}.`,
        });
      }
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not verify the key.' });
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async (p: SearchProvider) => {
    const label = PROVIDERS[p].label;
    const consequence = otherConfigured(p)
      ? `Searches will use your ${PROVIDERS[p === 'serpapi' ? 'serper' : 'serpapi'].label} key only.`
      : 'Searches cannot run until a search key is added.';
    if (!window.confirm(`Remove the stored ${label} key? ${consequence}`)) return;
    setBusy(`remove-${p}`);
    setNotice(null);
    try {
      const d = await patchMe({ [PROVIDERS[p].field]: null });
      setProfile(d.profile);
      setNotice({ tone: 'ok', text: `${label} key removed.` });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not remove the key.' });
    } finally {
      setBusy(null);
    }
  };

  const noSearchKey = profile !== null && !profile.serpapi.configured && !profile.serper?.configured;

  return (
    <div className="flex flex-col gap-6 max-w-[760px]">
      <PageHeader eyebrow="Settings" title="Account" description="Who outreach speaks for, and the search keys that pay for searches." />

      {notice && (
        <div className={`px-3 py-2 rounded-sm text-body-sm ${notice.tone === 'ok' ? 'bg-canvas border border-hairline text-ink' : 'bg-error-soft text-error-deep'}`}>{notice.text}</div>
      )}

      <form onSubmit={saveProfile} className="card">
        <div className="px-5 py-4 border-b border-hairline">
          <h2 className="text-label-sm text-ink">Profile</h2>
          <p className="text-body-sm text-mute mt-0.5">{profile?.email ?? ''}</p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Your name</span>
            <input className="input input-lg" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Company or organisation</span>
            <input className="input input-lg" value={company} onChange={(e) => setCompany(e.target.value)} />
            <span className="text-body-xs text-mute">Outreach messages are written in this name.</span>
          </label>
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className="field-label">
              DeepSeek API key <span className="text-mute font-normal">· optional</span>
            </span>
            <input type="password" autoComplete="off" className="input input-lg font-mono" value={deepseekKey} onChange={(e) => setDeepseekKey(e.target.value)} placeholder="Leave empty to use the platform key" />
            <span className="text-body-xs text-mute">Stored in this browser only. Used for JD parsing, query vocabulary and the agent when set.</span>
          </label>
        </div>
        <div className="px-5 py-3 border-t border-hairline bg-canvas flex justify-end rounded-b-md">
          <button type="submit" className="btn-primary" disabled={busy !== null}>
            {busy === 'profile' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save profile
          </button>
        </div>
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="search-keys-heading">
        <div>
          <h2 id="search-keys-heading" className="text-label-sm text-ink">
            Search keys
          </h2>
          <p className="text-body-sm text-mute mt-0.5">
            At least one is required to run a search. With both, Serper answers first and SerpAPI takes over only if Serper fails — never when a query simply has no results.
          </p>
        </div>
        {noSearchKey && (
          <div className="px-3 py-2 rounded-sm bg-warning-soft text-body-sm text-warning-deep">No search key on file — searches cannot run until you add one.</div>
        )}
        {(['serper', 'serpapi'] as const).map((p) => {
          const meta = PROVIDERS[p];
          const summary = keySummary(p);
          return (
            <form key={p} onSubmit={(e) => void saveKey(p, e)} className="card">
              <div className="px-5 py-4 border-b border-hairline flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-label-sm text-ink">{meta.label} key</h3>
                  <p className="text-body-sm text-mute mt-0.5">
                    {meta.blurb}{' '}
                    <a href={meta.href} target="_blank" rel="noreferrer" className="text-link hover:underline">
                      {meta.hrefLabel}
                    </a>
                  </p>
                </div>
                {summary?.configured ? (
                  <span className="chip flex-shrink-0">
                    <Check className="w-3 h-3" strokeWidth={2.5} /> ending {summary.last4}
                  </span>
                ) : (
                  <span className="chip flex-shrink-0 text-mute">none on file</span>
                )}
              </div>
              <div className="p-5 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="field-label">{summary?.configured ? 'Replace key' : 'Add key'}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className="input input-lg font-mono"
                    value={keyInput[p]}
                    onChange={(e) => setKeyInput((k) => ({ ...k, [p]: e.target.value }))}
                    placeholder={meta.placeholder}
                  />
                </label>
                {summary?.verifiedAt && <p className="text-body-xs text-mute">Last verified {new Date(summary.verifiedAt).toLocaleString()}.</p>}
              </div>
              <div className="px-5 py-3 border-t border-hairline bg-canvas flex items-center justify-between gap-2 rounded-b-md">
                {summary?.configured ? (
                  <button type="button" onClick={() => void removeKey(p)} className="btn-danger" disabled={busy !== null}>
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                ) : (
                  <span />
                )}
                <button type="submit" className="btn-primary" disabled={busy !== null || keyInput[p].trim().length < 8}>
                  {busy === `save-${p}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Verify and save
                </button>
              </div>
            </form>
          );
        })}
      </section>
    </div>
  );
}
