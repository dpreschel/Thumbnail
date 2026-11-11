import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { makeThumbnails, parseSizes, DEFAULT_SIZES } from '../src/thumbnails.js';
import { pngImage, isJpeg } from './helpers.js';

describe('parseSizes', () => {
  it('defaults when unset', () => {
    expect(parseSizes(undefined)).toEqual(DEFAULT_SIZES);
    expect(parseSizes('')).toEqual(DEFAULT_SIZES);
  });
  it('parses a custom list', () => {
    expect(parseSizes(' Tiny:160, hero:1920 ')).toEqual({ tiny: 160, hero: 1920 });
  });
  it.each(['small', 'small:abc', '../x:100', 'big:9999', 'small:10'])('rejects %j', (spec) => {
    expect(() => parseSizes(spec)).toThrow();
  });
});

describe('makeThumbnails', () => {
  it('produces a 16:10 JPEG per size, upscaling small sources', async () => {
    const out = await makeThumbnails(await pngImage(1280, 2000), { small: 320, large: 1280 });
    expect(Object.keys(out)).toEqual(['small', 'large']);
    for (const [name, width] of [['small', 320], ['large', 1280]]) {
      expect(isJpeg(out[name])).toBe(true);
      expect(await sharp(out[name]).metadata()).toMatchObject({ width, height: width * 10 / 16, format: 'jpeg' });
    }
  });
  it('rejects garbage input', async () => {
    await expect(makeThumbnails(Buffer.from('not an image'))).rejects.toThrow();
  });
});
