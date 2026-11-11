// Turn one source image (screenshot or og:image) into several JPEG sizes.
import sharp from 'sharp';

export const DEFAULT_SIZES = { small: 320, medium: 640, large: 1280 };
const ASPECT = 10 / 16; // matches the 1280x800 capture viewport

/**
 * Parse "small:320,medium:640,large:1280" (e.g. from the THUMBNAIL_SIZES env var).
 * Names must be simple words so they are safe in file names and URLs.
 */
export function parseSizes(spec) {
  if (!spec) return { ...DEFAULT_SIZES };
  const sizes = {};
  for (const part of spec.split(',')) {
    const m = /^\s*([a-z][a-z0-9]{0,15})\s*:\s*(\d{2,4})\s*$/i.exec(part);
    if (!m) throw new Error(`Invalid THUMBNAIL_SIZES entry "${part}". Use name:width, e.g. small:320`);
    const width = Number(m[2]);
    if (width < 32 || width > 2560) throw new Error(`Thumbnail width ${width} must be 32-2560px.`);
    sizes[m[1].toLowerCase()] = width;
  }
  return sizes;
}

/** @returns {Promise<Record<string, Buffer>>} one JPEG per named size */
export async function makeThumbnails(source, sizes = DEFAULT_SIZES) {
  // Untrusted input (og:image comes from arbitrary sites): cap decoded pixels
  // and only take the first frame of animations.
  const base = sharp(source, { limitInputPixels: 40_000_000, animated: false, failOn: 'error' }).rotate();
  const out = {};
  for (const [name, width] of Object.entries(sizes)) {
    out[name] = await base
      .clone()
      .resize({ width, height: Math.round(width * ASPECT), fit: 'cover', position: 'top', withoutEnlargement: false })
      .flatten({ background: '#ffffff' }) // transparent PNGs -> white, not black
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  }
  return out;
}
