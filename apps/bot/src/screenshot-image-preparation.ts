import sharp from 'sharp';

type ImageMimeType = 'image/jpeg' | 'image/png';

interface PreparedScreenshot {
  readonly image: Buffer;
  readonly mimeType: ImageMimeType;
}

const PREVIEW_SIZE = 128;
const MAX_IMAGE_PIXELS = 8_000_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/** Remove dark desktop margins around a phone screenshot without cropping a direct phone image. */
export async function prepareScreenshotForDigitalOcean(
  image: Buffer,
  mimeType: ImageMimeType,
): Promise<PreparedScreenshot> {
  const original = { image, mimeType };
  try {
    const source = sharp(image, { limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await source.metadata();
    const { width, height } = metadata;
    if (
      !width ||
      !height ||
      width < height * 1.3 ||
      (metadata.orientation !== undefined && metadata.orientation !== 1)
    ) {
      return original;
    }

    const { data, info } = await source
      .clone()
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const brightness: number[] = [];
    for (let x = 0; x < PREVIEW_SIZE; x += 1) {
      let total = 0;
      for (let y = 32; y < 96; y += 1) {
        total += data[(y * PREVIEW_SIZE + x) * info.channels] ?? 0;
      }
      brightness.push(total / 64);
    }
    const average = (values: readonly number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    const edge = average([...brightness.slice(0, 16), ...brightness.slice(112)]);
    const center = average(brightness.slice(48, 80));
    if (edge > 100 || center < 150 || center - edge < 70) return original;

    const threshold = Math.max(135, edge + 55);
    if ((brightness[64] ?? 0) < threshold) return original;
    let left = 64;
    let right = 64;
    while (left > 0 && (brightness[left - 1] ?? 0) >= threshold) left -= 1;
    while (right < PREVIEW_SIZE - 1 && (brightness[right + 1] ?? 0) >= threshold) right += 1;
    const portion = (right - left + 1) / PREVIEW_SIZE;
    if (left < 12 || right > 115 || portion < 0.2 || portion > 0.8) return original;

    const padding = Math.max(2, Math.round(width * 0.01));
    const cropLeft = Math.max(0, Math.floor((left / PREVIEW_SIZE) * width) - padding);
    const cropRight = Math.min(width, Math.ceil(((right + 1) / PREVIEW_SIZE) * width) + padding);
    if (cropRight - cropLeft >= width * 0.85) return original;
    const cropWidth = cropRight - cropLeft;
    let cropped = source.clone().extract({ left: cropLeft, top: 0, width: cropWidth, height });
    // Upscale narrow embedded phone captures before the model's image encoder sees the text.
    if (cropWidth < 600) cropped = cropped.resize({ width: cropWidth * 2 });
    const result =
      mimeType === 'image/png'
        ? await cropped.png().toBuffer()
        : await cropped.jpeg({ quality: 92 }).toBuffer();
    return result.length <= MAX_OUTPUT_BYTES ? { image: result, mimeType } : original;
  } catch {
    // A decode failure should not disable the existing model and local-OCR paths.
    return original;
  }
}
