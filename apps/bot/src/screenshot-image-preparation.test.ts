import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { prepareScreenshotForDigitalOcean } from './screenshot-image-preparation.js';

describe('Screenshot preparation', () => {
  it('removes dark desktop margins around a bright phone screenshot', async () => {
    const phone = await sharp({
      create: { width: 500, height: 900, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const desktop = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#242424' },
    })
      .composite([{ input: phone, left: 550, top: 0 }])
      .png()
      .toBuffer();

    const result = await prepareScreenshotForDigitalOcean(desktop, 'image/png');
    const metadata = await sharp(result.image).metadata();
    expect(metadata.width).toBeGreaterThan(960);
    expect(metadata.width).toBeLessThan(1200);
    expect(metadata.height).toBe(1800);
    expect(result.mimeType).toBe('image/png');
  });

  it('keeps a direct portrait phone screenshot intact', async () => {
    const phone = await sharp({
      create: { width: 900, height: 1600, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const result = await prepareScreenshotForDigitalOcean(phone, 'image/jpeg');
    expect(result.image).toBe(phone);
  });
});
