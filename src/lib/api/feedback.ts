import type { FeedbackKind, FeedbackStatus, FeedbackSummary } from '@/lib/db/feedback';

// Client helpers for the feedback API. Kept separate from src/lib/api/sessions.ts
// so the feedback page does not pull the session client along with it.

export type { FeedbackKind, FeedbackStatus, FeedbackSummary };

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

export async function listFeedback(scope: 'mine' | 'all'): Promise<{ is_admin: boolean; scope: 'mine' | 'all'; feedback: FeedbackSummary[] }> {
  return parse(await fetch(`/api/feedback?scope=${scope}`, { cache: 'no-store' }));
}

export async function submitFeedback(input: { kind: FeedbackKind; message: string; pageUrl?: string; images: File[] }): Promise<FeedbackSummary> {
  const form = new FormData();
  form.set('kind', input.kind);
  form.set('message', input.message);
  if (input.pageUrl) form.set('page_url', input.pageUrl);
  for (const file of input.images) form.append('images', file, file.name);
  const data = await parse<{ feedback: FeedbackSummary }>(await fetch('/api/feedback', { method: 'POST', body: form }));
  return data.feedback;
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackSummary> {
  const data = await parse<{ feedback: FeedbackSummary }>(
    await fetch(`/api/feedback/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
  );
  return data.feedback;
}

export async function deleteFeedback(id: string): Promise<void> {
  await parse(await fetch(`/api/feedback/${id}`, { method: 'DELETE' }));
}

export function feedbackImageUrl(feedbackId: string, imageId: string): string {
  return `/api/feedback/${feedbackId}/images/${imageId}`;
}
