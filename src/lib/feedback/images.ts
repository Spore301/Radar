import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Screenshot compression for tester feedback.
//
// Every image is re-encoded on the server before it is stored: rotated
// according to its EXIF orientation, scaled to fit 1600 px, and written as
// WebP. A 5 MB phone screenshot lands at roughly 100–300 KB. Re-encoding also
// strips metadata (location, device), and means the stored bytes are always
// an image we produced rather than whatever the browser sent.
// ---------------------------------------------------------------------------

export const MAX_IMAGES_PER_REPORT = 4;
export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_EDGE_PX = 1600;
const WEBP_QUALITY = 78;

/** Formats sharp can decode with its bundled libvips; anything else is refused. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff']);

export interface CompressedImage {
  data: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
  bytes: number;
}

export class ImageRejectedError extends Error {}

export async function compressImage(input: Buffer): Promise<CompressedImage> {
  if (input.length === 0) throw new ImageRejectedError('The image file is empty.');
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageRejectedError(`Images must be under ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB.`);
  }

  const meta = await sharp(input, { animated: false }).metadata().catch(() => null);
  if (!meta?.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new ImageRejectedError('Unsupported image. Use PNG, JPEG, WebP or GIF.');
  }

  const { data, info } = await sharp(input, { animated: false })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return { data, mimeType: 'image/webp', width: info.width, height: info.height, bytes: data.length };
}
