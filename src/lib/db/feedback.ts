import { Prisma, type FeedbackKind, type FeedbackStatus } from '@prisma/client';
import { prisma } from './client';
import type { CompressedImage } from '../feedback/images';

// ---------------------------------------------------------------------------
// Feedback repository. A report belongs to the user who filed it; admins
// (see isAdminEmail in src/lib/session.ts) may read and resolve every report.
// Image bytes are never returned in a listing — they are streamed one at a
// time by GET /api/feedback/:id/images/:imageId after the same ownership
// check, so a report id alone is never enough to fetch a screenshot.
// ---------------------------------------------------------------------------

export type { FeedbackKind, FeedbackStatus };

export interface FeedbackImageSummary {
  id: string;
  width: number;
  height: number;
  bytes: number;
  original_bytes: number;
}

export interface FeedbackSummary {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  message: string;
  page_url: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Who filed it; only admins see other people's reports, so only they see this filled. */
  reporter: { name: string | null; email: string | null; company: string | null };
  images: FeedbackImageSummary[];
}

export interface Viewer {
  userId: string;
  admin: boolean;
}

// Prisma.validator keeps the literal shape so the query result type carries
// `user` and `images`; a plain `as const` object loses that inference.
const SUMMARY_SELECT = Prisma.validator<Prisma.FeedbackSelect>()({
  id: true,
  kind: true,
  status: true,
  message: true,
  pageUrl: true,
  createdAt: true,
  resolvedAt: true,
  user: { select: { name: true, email: true, company: true } },
  images: { select: { id: true, width: true, height: true, bytes: true, originalBytes: true }, orderBy: { createdAt: 'asc' } },
});

type SummaryRow = Prisma.FeedbackGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary(r: SummaryRow): FeedbackSummary {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    message: r.message,
    page_url: r.pageUrl,
    created_at: r.createdAt.toISOString(),
    resolved_at: r.resolvedAt?.toISOString() ?? null,
    reporter: r.user,
    images: r.images.map((i) => ({ id: i.id, width: i.width, height: i.height, bytes: i.bytes, original_bytes: i.originalBytes })),
  };
}

export interface NewFeedbackInput {
  kind: FeedbackKind;
  message: string;
  pageUrl?: string | null;
  userAgent?: string | null;
}

export interface NewFeedbackImage {
  compressed: CompressedImage;
  originalBytes: number;
  originalName?: string | null;
}

export async function createFeedback(userId: string, input: NewFeedbackInput, images: NewFeedbackImage[]): Promise<FeedbackSummary> {
  const row = await prisma.feedback.create({
    data: {
      userId,
      kind: input.kind,
      message: input.message,
      pageUrl: input.pageUrl ?? null,
      userAgent: input.userAgent ?? null,
      images: {
        create: images.map((img) => ({
          mimeType: img.compressed.mimeType,
          width: img.compressed.width,
          height: img.compressed.height,
          bytes: img.compressed.bytes,
          originalBytes: img.originalBytes,
          originalName: img.originalName ?? null,
          // Prisma's Bytes input wants a plain Uint8Array over an ArrayBuffer;
          // a Node Buffer's ArrayBufferLike does not satisfy that type.
          data: Uint8Array.from(img.compressed.data),
        })),
      },
    },
    select: SUMMARY_SELECT,
  });
  return toSummary(row);
}

/** The viewer's own reports, or every report when `all` is asked for by an admin. */
export async function listFeedback(viewer: Viewer, all: boolean): Promise<FeedbackSummary[]> {
  const rows = await prisma.feedback.findMany({
    where: viewer.admin && all ? {} : { userId: viewer.userId },
    orderBy: { createdAt: 'desc' },
    select: SUMMARY_SELECT,
  });
  return rows.map(toSummary);
}

/** One stored screenshot, if the viewer may see the report it belongs to. */
export async function getFeedbackImage(
  feedbackId: string,
  imageId: string,
  viewer: Viewer
): Promise<{ data: Buffer; mimeType: string; bytes: number } | null> {
  const row = await prisma.feedbackImage.findFirst({
    where: { id: imageId, feedbackId, ...(viewer.admin ? {} : { feedback: { userId: viewer.userId } }) },
    select: { data: true, mimeType: true, bytes: true },
  });
  return row ? { data: Buffer.from(row.data), mimeType: row.mimeType, bytes: row.bytes } : null;
}

/** Admin only: open ↔ resolved. Returns null when the report does not exist. */
export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackSummary | null> {
  const exists = await prisma.feedback.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const row = await prisma.feedback.update({
    where: { id },
    data: { status, resolvedAt: status === 'resolved' ? new Date() : null },
    select: SUMMARY_SELECT,
  });
  return toSummary(row);
}

/** The reporter may withdraw their own report; an admin may delete any. Images cascade. */
export async function deleteFeedback(id: string, viewer: Viewer): Promise<boolean> {
  const exists = await prisma.feedback.findFirst({
    where: { id, ...(viewer.admin ? {} : { userId: viewer.userId }) },
    select: { id: true },
  });
  if (!exists) return false;
  await prisma.feedback.delete({ where: { id } });
  return true;
}
