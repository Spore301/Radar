'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Bug, Check, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { deleteFeedback, feedbackImageUrl, listFeedback, setFeedbackStatus, submitFeedback, type FeedbackKind, type FeedbackSummary } from '@/lib/api/feedback';

// ---------------------------------------------------------------------------
// Feedback: testers describe a bug or idea and attach up to four screenshots.
// Images are compressed on the server before they are stored (WebP, ≤1600px),
// and the list shows the saved size next to the original so that is visible.
// Everyone sees their own reports; admins (ADMIN_EMAILS) can switch to all
// reports and mark them resolved.
// ---------------------------------------------------------------------------

const MAX_IMAGES = 4;
const MAX_BYTES = 12 * 1024 * 1024;

const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Bug', idea: 'Idea', other: 'Other' };

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Pending {
  file: File;
  previewUrl: string;
}

export default function FeedbackPage() {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [where, setWhere] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [reports, setReports] = useState<FeedbackSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (s: 'mine' | 'all') => {
    try {
      const data = await listFeedback(s);
      setIsAdmin(data.is_admin);
      setReports(data.feedback);
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not load reports.' });
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  // Object URLs are released when previews change or the page unmounts.
  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.previewUrl)), [pending]);

  const addFiles = (files: FileList | File[]) => {
    setNotice(null);
    const next: Pending[] = [...pending];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_IMAGES) {
        setNotice({ tone: 'error', text: `Up to ${MAX_IMAGES} images per report.` });
        break;
      }
      if (!file.type.startsWith('image/')) {
        setNotice({ tone: 'error', text: `"${file.name}" is not an image.` });
        continue;
      }
      if (file.size > MAX_BYTES) {
        setNotice({ tone: 'error', text: `"${file.name}" is over 12 MB.` });
        continue;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setPending(next);
  };

  const removePending = (idx: number) => {
    setPending((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const onDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const canSubmit = message.trim().length > 0 && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const saved = await submitFeedback({ kind, message: message.trim(), pageUrl: where.trim() || undefined, images: pending.map((p) => p.file) });
      const savedBytes = saved.images.reduce((n, i) => n + i.bytes, 0);
      const originalBytes = saved.images.reduce((n, i) => n + i.original_bytes, 0);
      setNotice({
        tone: 'ok',
        text: saved.images.length
          ? `Thanks — report saved with ${saved.images.length} image${saved.images.length === 1 ? '' : 's'} (${kb(originalBytes)} → ${kb(savedBytes)} after compression).`
          : 'Thanks — report saved.',
      });
      setMessage('');
      setWhere('');
      setPending([]);
      setKind('bug');
      await load(scope);
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'The report could not be saved.' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (r: FeedbackSummary) => {
    setBusyId(r.id);
    try {
      const updated = await setFeedbackStatus(r.id, r.status === 'open' ? 'resolved' : 'open');
      setReports((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not update the report.' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r: FeedbackSummary) => {
    if (!window.confirm('Delete this report and its images?')) return;
    setBusyId(r.id);
    try {
      await deleteFeedback(r.id);
      setReports((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not delete the report.' });
    } finally {
      setBusyId(null);
    }
  };

  const openCount = useMemo(() => reports?.filter((r) => r.status === 'open').length ?? 0, [reports]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Testing"
        title="Feedback"
        description="Found a bug, or want something changed? Describe it and attach screenshots. Images are compressed before they are stored."
      />

      <form onSubmit={submit} className="card">
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-label-sm text-ink">New report</h2>
          <div className="seg" role="group" aria-label="Kind of report">
            {(['bug', 'idea', 'other'] as FeedbackKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className="seg-item">
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label text-ink">What happened?</span>
            <textarea
              className="textarea min-h-[120px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              placeholder={
                kind === 'bug'
                  ? 'What did you do, what did you expect, and what happened instead? Include the session or candidate if it helps.'
                  : kind === 'idea'
                    ? 'What would make this more useful for you?'
                    : 'Anything else you want us to know.'
              }
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">Where did it happen? <span className="text-mute font-normal">optional</span></span>
            <input className="input" value={where} onChange={(e) => setWhere(e.target.value)} maxLength={500} placeholder="e.g. Pipeline board, or paste the page address" />
          </label>

          <div className="flex flex-col gap-2">
            <span className="field-label">
              Screenshots <span className="text-mute font-normal">optional, up to {MAX_IMAGES}</span>
            </span>
            <div
              onDragEnter={onDrag}
              onDragOver={onDrag}
              onDragLeave={onDrag}
              onDrop={onDrop}
              className={`rounded-md border border-dashed p-4 transition-colors ${dragActive ? 'border-ink bg-hairline-soft' : 'border-faint/60 bg-canvas'}`}
            >
              <div className="flex flex-wrap gap-3 items-start">
                {pending.map((p, idx) => (
                  <div key={p.previewUrl} className="relative w-28 h-20 rounded-sm overflow-hidden border border-hairline bg-elevated">
                    {/* Local preview of a not-yet-uploaded file; next/image cannot size a blob URL. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePending(idx)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-sm bg-ink text-white inline-flex items-center justify-center hover:bg-[#383838]"
                      aria-label={`Remove ${p.file.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {pending.length < MAX_IMAGES && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-28 h-20 rounded-sm border border-hairline bg-elevated text-body hover:text-ink hover:bg-hairline-soft inline-flex flex-col items-center justify-center gap-1 text-body-xs transition-colors"
                  >
                    <ImagePlus className="w-4 h-4" strokeWidth={1.75} />
                    Add image
                  </button>
                )}
              </div>
              <p className="text-body-xs text-mute mt-3">Drop images here or click Add image. PNG, JPEG, WebP or GIF, up to 12 MB each. They are resized and stored as WebP.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {notice && (
            <div className={`px-3 py-2 rounded-sm text-body-sm ${notice.tone === 'ok' ? 'bg-hairline-soft text-ink' : 'bg-error-soft text-error-deep'}`} role="status">
              {notice.text}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="submit" className="btn-primary btn-lg" disabled={!canSubmit}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bug className="w-4 h-4" strokeWidth={1.75} />}
              {submitting ? 'Saving…' : 'Send report'}
            </button>
          </div>
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h2 className="text-heading-md text-ink">{scope === 'all' ? 'All reports' : 'Your reports'}</h2>
            {reports && <span className="text-body-sm text-mute">{reports.length} total · {openCount} open</span>}
          </div>
          {isAdmin && (
            <div className="seg" role="group" aria-label="Which reports to show">
              <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')} className="seg-item">
                Mine
              </button>
              <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')} className="seg-item">
                All testers
              </button>
            </div>
          )}
        </div>

        {reports === null ? (
          <div className="card p-6 text-body-sm text-mute">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="card p-6 text-body-sm text-mute">Nothing reported yet.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((r) => (
              <li key={r.id} className="card p-5 flex flex-col gap-3" data-feedback-id={r.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={r.kind === 'bug' ? 'chip-ink' : 'chip'}>{KIND_LABEL[r.kind]}</span>
                    <span className={`chip ${r.status === 'resolved' ? 'text-mute' : 'text-ink'}`}>
                      {r.status === 'resolved' ? <Check className="w-3 h-3" strokeWidth={2.5} /> : null}
                      {r.status === 'resolved' ? 'Resolved' : 'Open'}
                    </span>
                    <span className="text-body-xs text-mute">
                      {timeAgo(r.created_at)}
                      {scope === 'all' && (r.reporter.name || r.reporter.email) ? ` · ${r.reporter.name ?? r.reporter.email}${r.reporter.company ? `, ${r.reporter.company}` : ''}` : ''}
                      {r.page_url ? ` · ${r.page_url}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isAdmin && (
                      <button type="button" onClick={() => toggleStatus(r)} className="btn-ghost btn-sm" disabled={busyId === r.id}>
                        {r.status === 'open' ? 'Mark resolved' : 'Reopen'}
                      </button>
                    )}
                    <button type="button" onClick={() => remove(r)} className="btn-icon btn-sm" disabled={busyId === r.id} aria-label="Delete report" title="Delete report">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-body-md text-ink whitespace-pre-wrap">{r.message}</p>

                {r.images.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {r.images.map((img) => (
                      <li key={img.id} className="flex flex-col gap-1">
                        <a href={feedbackImageUrl(r.id, img.id)} target="_blank" rel="noreferrer" className="block rounded-sm overflow-hidden border border-hairline bg-elevated">
                          <Image src={feedbackImageUrl(r.id, img.id)} alt="" width={img.width} height={img.height} unoptimized className="h-24 w-auto object-cover" />
                        </a>
                        <span className="text-body-xs text-mute tabular-nums">
                          {img.width}×{img.height} · {kb(img.bytes)} <span className="text-faint">from {kb(img.original_bytes)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
