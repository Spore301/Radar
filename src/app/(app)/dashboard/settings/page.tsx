'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

interface Profile {
  name: string | null;
  email: string | null;
  company: string | null;
  serpapi: { configured: boolean; last4: string | null; verifiedAt: string | null };
}

async function patchMe(body: Record<string, unknown>) {
  const res = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data as { profile: Profile; serpapi?: { last4: string; searchesLeft?: number; planName?: string } };
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [serpKey, setSerpKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [busy, setBusy] = useState<'profile' | 'serp' | 'remove' | null>(null);
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

  const saveSerp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('serp');
    setNotice(null);
    try {
      const d = await patchMe({ serpapi_key: serpKey.trim() });
      setProfile(d.profile);
      setSerpKey('');
      const s = d.serpapi;
      setNotice({
        tone: 'ok',
        text: `SerpAPI key ending ${s?.last4 ?? '…'} verified and saved${s?.planName ? ` · ${s.planName}` : ''}${
          typeof s?.searchesLeft === 'number' ? ` · ${s.searchesLeft.toLocaleString()} searches left this month` : ''
        }.`,
      });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not verify the key.' });
    } finally {
      setBusy(null);
    }
  };

  const removeSerp = async () => {
    if (!window.confirm('Remove the stored SerpAPI key? Searches will return nothing until a new one is added.')) return;
    setBusy('remove');
    setNotice(null);
    try {
      const d = await patchMe({ serpapi_key: null });
      setProfile(d.profile);
      setNotice({ tone: 'ok', text: 'SerpAPI key removed.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not remove the key.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[760px]">
      <PageHeader eyebrow="Settings" title="Account" description="Who outreach speaks for, and the SerpAPI account that pays for searches." />

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

      <form onSubmit={saveSerp} className="card">
        <div className="px-5 py-4 border-b border-hairline flex items-start justify-between gap-4">
          <div>
            <h2 className="text-label-sm text-ink">SerpAPI key</h2>
            <p className="text-body-sm text-mute mt-0.5">
              Every results page costs one credit from this account. Free accounts are small — swap the key here when you switch accounts.{' '}
              <a href="https://serpapi.com/manage-api-key" target="_blank" rel="noreferrer" className="text-link hover:underline">
                Manage keys
              </a>
            </p>
          </div>
          {profile?.serpapi.configured ? (
            <span className="chip">
              <Check className="w-3 h-3" strokeWidth={2.5} /> ending {profile.serpapi.last4}
            </span>
          ) : (
            <span className="chip text-warning-deep border-warning">none on file</span>
          )}
        </div>
        <div className="p-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{profile?.serpapi.configured ? 'Replace key' : 'Add key'}</span>
            <input type="password" autoComplete="off" className="input input-lg font-mono" value={serpKey} onChange={(e) => setSerpKey(e.target.value)} placeholder="Paste a SerpAPI key" />
          </label>
          {profile?.serpapi.verifiedAt && <p className="text-body-xs text-mute">Last verified {new Date(profile.serpapi.verifiedAt).toLocaleString()}.</p>}
        </div>
        <div className="px-5 py-3 border-t border-hairline bg-canvas flex items-center justify-between gap-2 rounded-b-md">
          {profile?.serpapi.configured ? (
            <button type="button" onClick={() => void removeSerp()} className="btn-danger" disabled={busy !== null}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn-primary" disabled={busy !== null || serpKey.trim().length < 8}>
            {busy === 'serp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Verify and save
          </button>
        </div>
      </form>
    </div>
  );
}
