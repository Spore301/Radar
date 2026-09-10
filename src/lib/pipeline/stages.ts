import type { CandidateProfile, CandidateStatus, OutreachChannel } from '../types';

// ---------------------------------------------------------------------------
// The candidate pipeline — one ordered definition used by the board, the
// table, the drawer and the server.
//
// Left to right is increasing commitment:
//
//   New → Reviewed → Saved → Shortlisted → Contacted → Replied   (+ Archived)
//
//   New          indexed by a search, nobody has looked yet
//   Reviewed     a recruiter opened the profile and has not decided
//   Saved        worth keeping — a "maybe", parked for later
//   Shortlisted  a "yes" — the next step is to reach out
//   Contacted    outreach has been logged (a message, or a connection note)
//   Replied      the candidate answered; the conversation is live
//   Archived     closed, for any reason — off the board, never deleted
//
// Contacted is reached by logging outreach, not by dragging a card: the log is
// what makes the stage mean something. Everything else is a manual decision.
// ---------------------------------------------------------------------------

export interface StageDef {
  id: CandidateStatus;
  label: string;
  /** One line under the column header. */
  hint: string;
  /** Shown as a board column. Archived is a bucket, not a column. */
  onBoard: boolean;
}

export const STAGES: readonly StageDef[] = [
  { id: 'New', label: 'New', hint: 'Indexed, not yet looked at', onBoard: true },
  { id: 'Reviewed', label: 'Reviewed', hint: 'Opened, undecided', onBoard: true },
  { id: 'Saved', label: 'Saved', hint: 'A maybe — parked for later', onBoard: true },
  { id: 'Shortlisted', label: 'Shortlisted', hint: 'A yes — reach out next', onBoard: true },
  { id: 'Contacted', label: 'Contacted', hint: 'Outreach logged, awaiting a reply', onBoard: true },
  { id: 'Replied', label: 'Replied', hint: 'In conversation', onBoard: true },
  { id: 'Archived', label: 'Archived', hint: 'Closed', onBoard: false },
] as const;

export const STAGE_ORDER: readonly CandidateStatus[] = STAGES.map((s) => s.id);
export const BOARD_STAGES: readonly StageDef[] = STAGES.filter((s) => s.onBoard);

export function stageIndex(status: CandidateStatus): number {
  return STAGE_ORDER.indexOf(status);
}

export function stageLabel(status: CandidateStatus): string {
  return STAGES.find((s) => s.id === status)?.label ?? status;
}

/** True when `status` is at or beyond `floor` in the funnel. */
export function isAtLeast(status: CandidateStatus, floor: CandidateStatus): boolean {
  return stageIndex(status) >= stageIndex(floor);
}

/**
 * The manual forward step from a stage, or null when the next step is not a
 * drag: Shortlisted → Contacted happens by logging outreach, and Replied has
 * no automatic successor.
 */
export function nextManualStage(status: CandidateStatus): CandidateStatus | null {
  switch (status) {
    case 'New':
      return 'Reviewed';
    case 'Reviewed':
      return 'Saved';
    case 'Saved':
      return 'Shortlisted';
    case 'Contacted':
      return 'Replied';
    default:
      return null;
  }
}

// --- Outreach channels ---------------------------------------------------------

export interface ChannelDef {
  id: OutreachChannel;
  label: string;
  /** Short form for chips. */
  short: string;
  /** Hard cap the platform enforces, when there is one. */
  maxChars?: number;
  hasSubject: boolean;
  hint: string;
}

/**
 * LinkedIn's connection request note is capped at 300 characters and is the
 * first touch for most passive candidates — it is tracked as its own channel
 * so the board can tell "request sent, waiting to connect" from "messaged".
 */
export const CHANNELS: readonly ChannelDef[] = [
  { id: 'LinkedIn Note', label: 'LinkedIn connection note', short: 'Connection note', maxChars: 300, hasSubject: false, hint: '300 characters · sent with the connection request' },
  { id: 'LinkedIn DM', label: 'LinkedIn message', short: 'LinkedIn DM', hasSubject: false, hint: 'InMail or a message to a connection' },
  { id: 'Email', label: 'Email', short: 'Email', hasSubject: true, hint: 'With a subject line' },
  { id: 'WhatsApp', label: 'WhatsApp', short: 'WhatsApp', hasSubject: false, hint: 'Short and conversational' },
  { id: 'Call', label: 'Call script', short: 'Call', hasSubject: false, hint: 'Talking points for a first call' },
] as const;

export const CHANNEL_IDS: readonly OutreachChannel[] = CHANNELS.map((c) => c.id);

export function channelDef(id: OutreachChannel): ChannelDef {
  return CHANNELS.find((c) => c.id === id) ?? CHANNELS[1];
}

/** Days to suggest for the next follow-up after outreach on a channel, when none is set. */
export function defaultFollowUpDays(channel: OutreachChannel): number {
  // Connection requests take longer to be seen than a direct message.
  return channel === 'LinkedIn Note' ? 5 : 3;
}

// --- Time helpers for the tracking chips ------------------------------------------

const DAY = 86_400_000;

/** "today", "2d ago", "3w ago" — for stage age and last outreach. */
export function relativeAgo(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return '';
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export type FollowUpState = { kind: 'none' } | { kind: 'overdue'; days: number } | { kind: 'today' } | { kind: 'upcoming'; days: number };

/** How a follow-up date relates to today, for the chip and for sorting. */
export function followUpState(iso: string | undefined | null, now = Date.now()): FollowUpState {
  if (!iso) return { kind: 'none' };
  const due = new Date(iso);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diff = Math.round((dueDay.getTime() - startOfToday.getTime()) / DAY);
  if (diff < 0) return { kind: 'overdue', days: -diff };
  if (diff === 0) return { kind: 'today' };
  return { kind: 'upcoming', days: diff };
}

export function followUpLabel(state: FollowUpState): string {
  switch (state.kind) {
    case 'overdue':
      return `Follow-up overdue · ${state.days}d`;
    case 'today':
      return 'Follow up today';
    case 'upcoming':
      return `Follow up in ${state.days}d`;
    default:
      return '';
  }
}

/**
 * Board order inside a column: anything overdue first, then due today, then
 * by soonest follow-up, then most recently updated. Tracking is about what
 * needs doing next, not about who scored highest.
 */
export function compareForBoard(a: CandidateProfile, b: CandidateProfile, now = Date.now()): number {
  const rank = (c: CandidateProfile) => {
    const s = followUpState(c.next_follow_up, now);
    if (s.kind === 'overdue') return 0;
    if (s.kind === 'today') return 1;
    if (s.kind === 'upcoming') return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.next_follow_up && b.next_follow_up) {
    const d = new Date(a.next_follow_up).getTime() - new Date(b.next_follow_up).getTime();
    if (d !== 0) return d;
  }
  return new Date(b.stage_changed_at ?? b.discovered_at).getTime() - new Date(a.stage_changed_at ?? a.discovered_at).getTime();
}
