'use client';

import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

interface KeyField {
  id: 'DEEPSEEK_API_KEY' | 'SERPAPI_KEY' | 'BRAVE_SEARCH_KEY';
  label: string;
  placeholder: string;
  help: React.ReactNode;
}

const FIELDS: KeyField[] = [
  {
    id: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek API key',
    placeholder: 'sk-…',
    help: (
      <>
        Structures job descriptions, supplies the sourcing vocabulary the query templates are filled from, and drafts outreach.{' '}
        <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer" className="text-link hover:underline">
          platform.deepseek.com
        </a>
      </>
    ),
  },
  {
    id: 'SERPAPI_KEY',
    label: 'SerpAPI key',
    placeholder: 'serpapi_key_…',
    help: (
      <>
        Runs every X-Ray query individually against Google and pages through results. One credit per page.{' '}
        <a href="https://serpapi.com" target="_blank" rel="noreferrer" className="text-link hover:underline">
          serpapi.com
        </a>
      </>
    ),
  },
  {
    id: 'BRAVE_SEARCH_KEY',
    label: 'Brave Search API key',
    placeholder: 'BSA…',
    help: (
      <>
        Stored for a future second engine; not used by searches yet.{' '}
        <a href="https://brave.com/search/api" target="_blank" rel="noreferrer" className="text-link hover:underline">
          brave.com/search/api
        </a>
      </>
    ),
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<KeyField['id'], string>>({ DEEPSEEK_API_KEY: '', SERPAPI_KEY: '', BRAVE_SEARCH_KEY: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      setValues({
        DEEPSEEK_API_KEY: localStorage.getItem('DEEPSEEK_API_KEY') ?? '',
        SERPAPI_KEY: localStorage.getItem('SERPAPI_KEY') ?? '',
        BRAVE_SEARCH_KEY: localStorage.getItem('BRAVE_SEARCH_KEY') ?? '',
      });
    } catch {
      // Storage blocked — the form still works for this tab.
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      for (const f of FIELDS) localStorage.setItem(f.id, values[f.id].trim());
    } catch {
      // ignore
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 max-w-[760px]">
      <PageHeader
        eyebrow="Settings"
        title="API keys"
        description="Keys are stored in this browser and sent with each request. Keys in the project's .env.local are used when a field is empty."
      />

      <form onSubmit={handleSave} className="card divide-y divide-hairline">
        {FIELDS.map((f) => (
          <div key={f.id} className="p-5 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-2 md:gap-6">
            <div>
              <label htmlFor={f.id} className="field-label">
                {f.label}
              </label>
              <p className="text-body-xs text-mute mt-0.5 font-mono">{f.id}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                id={f.id}
                type="password"
                autoComplete="off"
                value={values[f.id]}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                placeholder={f.placeholder}
                className="input input-lg font-mono"
              />
              <p className="text-body-xs text-mute">{f.help}</p>
            </div>
          </div>
        ))}
        <div className="p-4 flex items-center justify-between gap-3 bg-canvas rounded-b-md">
          <p className="text-body-xs text-mute">
            Or set them on the server in <code className="font-mono text-ink">.env.local</code>: DEEPSEEK_API_KEY, SERPAPI_KEY, BRAVE_SEARCH_KEY.
          </p>
          <button type="submit" className="btn-primary">
            {saved ? (
              <>
                <Check className="w-3.5 h-3.5" /> Saved
              </>
            ) : (
              'Save keys'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
