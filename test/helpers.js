import sharp from 'sharp';

/** A real (tiny) PNG so sharp has something to chew on. */
export const pngImage = (width = 200, height = 120, color = '#3b5bdb') =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

export const isJpeg = (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
