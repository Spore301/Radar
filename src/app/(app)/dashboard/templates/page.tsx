'use client';

import React, { useState } from 'react';
import { MessageTemplate, OutreachChannel } from '@/lib/types';
import { INITIAL_MESSAGE_TEMPLATES } from '@/lib/seedData';
import { Plus, Pencil, Check, Copy } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { CHANNELS } from '@/lib/pipeline/stages';

const VARIABLES = ['candidate_name', 'role_title', 'company_name', 'top_skills'] as const;

const PREVIEW = {
  candidate_name: 'Aanya Verma',
  role_title: 'Senior Product Designer',
  company_name: 'CandidateRadar',
  top_skills: 'Figma, Design Systems, User Research',
};

function render(body: string): string {
  return body
    .replace(/{{candidate_name}}/g, PREVIEW.candidate_name)
    .replace(/{{role_title}}/g, PREVIEW.role_title)
    .replace(/{{company_name}}/g, PREVIEW.company_name)
    .replace(/{{top_skills}}/g, PREVIEW.top_skills);
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>(INITIAL_MESSAGE_TEMPLATES);
  const [selectedId, setSelectedId] = useState<string | null>(INITIAL_MESSAGE_TEMPLATES[0]?.id ?? null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; channel: OutreachChannel; tone: MessageTemplate['tone']; body: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const startEdit = (t?: MessageTemplate) => {
    setEditing(
      t
        ? { id: t.id, name: t.name, channel: t.channel, tone: t.tone ?? 'Warm', body: t.body }
        : {
            id: null,
            name: 'New outreach template',
            channel: 'LinkedIn DM',
            tone: 'Warm',
            body: 'Hi {{candidate_name}},\n\nI was impressed by your background in {{top_skills}}. We are looking for a {{role_title}} to join {{company_name}}.\n\nWould you be open to a brief chat next week?',
          }
    );
  };

  const save = () => {
    if (!editing) return;
    if (editing.id) {
      setTemplates((prev) => prev.map((t) => (t.id === editing.id ? { ...t, name: editing.name, channel: editing.channel, tone: editing.tone, body: editing.body } : t)));
      setSelectedId(editing.id);
    } else {
      const t: MessageTemplate = { id: `tmpl-${Date.now()}`, name: editing.name, channel: editing.channel, tone: editing.tone, body: editing.body, created_at: new Date().toISOString() };
      setTemplates((prev) => [...prev, t]);
      setSelectedId(t.id);
    }
    setEditing(null);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Templates · ${templates.length}`}
        title="Message templates"
        description="Reusable outreach drafts with variables filled from the candidate and the session's role."
        actions={
          <button type="button" onClick={() => startEdit()} className="btn-primary">
            <Plus className="w-3.5 h-3.5" /> New template
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 items-start">
        <ul className="card divide-y divide-hairline overflow-hidden">
          {templates.map((t) => {
            const on = t.id === selectedId && !editing;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(t.id);
                    setEditing(null);
                  }}
                  aria-current={on ? 'true' : undefined}
                  className={`w-full text-left px-4 py-3 transition-colors ${on ? 'bg-hairline-soft' : 'hover:bg-hairline-soft'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body-sm font-medium text-ink truncate">{t.name}</span>
                    <span className="chip">{t.channel}</span>
                  </div>
                  <p className="text-body-xs text-mute mt-1 line-clamp-2">{t.body}</p>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="card">
          {editing ? (
            <div className="flex flex-col">
              <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
                <h2 className="text-label-sm text-ink">{editing.id ? 'Edit template' : 'New template'}</h2>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditing(null)} className="btn-ghost">
                    Cancel
                  </button>
                  <button type="button" onClick={save} className="btn-primary">
                    Save
                  </button>
                </div>
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1.5 sm:col-span-1">
                    <span className="field-label">Name</span>
                    <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="field-label">Channel</span>
                    <select className="select" value={editing.channel} onChange={(e) => setEditing({ ...editing, channel: e.target.value as OutreachChannel })}>
                      {CHANNELS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="field-label">Tone</span>
                    <select className="select" value={editing.tone ?? 'Warm'} onChange={(e) => setEditing({ ...editing, tone: e.target.value as MessageTemplate['tone'] })}>
                      <option value="Warm">Warm</option>
                      <option value="Professional">Professional</option>
                      <option value="Direct">Direct</option>
                      <option value="Short & Punchy">Short & punchy</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="field-label">Insert variable</span>
                  <div className="flex flex-wrap gap-1.5">
                    {VARIABLES.map((v) => (
                      <button key={v} type="button" onClick={() => setEditing({ ...editing, body: `${editing.body} {{${v}}}` })} className="chip font-mono hover:border-ink">
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="field-label">Body</span>
                  <textarea rows={9} className="textarea" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                </label>
              </div>
            </div>
          ) : selected ? (
            <div className="flex flex-col">
              <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-label-sm text-ink truncate">{selected.name}</h2>
                  <p className="text-body-xs text-mute">
                    {selected.channel}
                    {selected.tone ? ` · ${selected.tone}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void copy(render(selected.body))} className="btn-ghost">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy preview'}
                  </button>
                  <button type="button" onClick={() => startEdit(selected)} className="btn-ghost">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              </div>
              <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="flex flex-col gap-2">
                  <span className="eyebrow">Template</span>
                  <pre className="whitespace-pre-wrap font-sans text-body-sm text-body leading-relaxed">{selected.body}</pre>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="eyebrow">Preview · sample candidate {PREVIEW.candidate_name}</span>
                  <pre className="whitespace-pre-wrap font-sans text-body-sm text-ink leading-relaxed well p-4">{render(selected.body)}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-body-sm text-mute">Select a template or create a new one.</div>
          )}
        </div>
      </div>
    </div>
  );
}
