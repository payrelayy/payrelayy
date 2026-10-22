/** Extracts a candidate reference only. The signed receiver SMS remains payment authority. */
export const DIGITALOCEAN_SCREENSHOT_MODEL = 'nemotron-3.5-super-vl';
const DIGITALOCEAN_INFERENCE_URL = 'https://inference.do-ai.run/v1/chat/completions';
const MAX_RESPONSE_BYTES = 16 * 1024;
const REFERENCE = /^(?=[A-Za-z0-9]{10,11}$)(?=.*[0-9])[A-Za-z0-9]+$/u;

export type ScreenshotReferenceResult =
  | {
      readonly kind: 'candidate';
      readonly reference: string;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
    }
  | {
      readonly kind: 'unreadable';
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
    }
  | { readonly kind: 'unavailable' };

interface Dependencies {
  readonly modelAccessKey: string;
  readonly fetch?: typeof fetch;
}

function usageTokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function boundedResponseText(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function readDigitalOceanScreenshotReference(
  image: Buffer,
  mimeType: 'image/jpeg' | 'image/png',
  dependencies: Dependencies,
): Promise<ScreenshotReferenceResult> {
  try {
    const response = await (dependencies.fetch ?? fetch)(DIGITALOCEAN_INFERENCE_URL, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${dependencies.modelAccessKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DIGITALOCEAN_SCREENSHOT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Read the transaction reference in this TeleBirr or CBE Birr payment screenshot. Return only the exact 10 or 11 alphanumeric characters, with no punctuation or explanation. If any character is unclear, or there is more than one possible reference, return UNREADABLE. Do not guess or use amounts, phone numbers, dates, or account numbers.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` },
              },
            ],
          },
        ],
        // Nemotron may spend several hundred tokens in reasoning_content before content appears.
        max_tokens: 1024,
        temperature: 0,
      }),
    });
    if (!response.ok) return { kind: 'unavailable' };
    const text = await boundedResponseText(response);
    if (!text) return { kind: 'unavailable' };
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null) return { kind: 'unavailable' };
    const value = body as {
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const choice = value.choices?.[0];
    const inputTokens = usageTokens(value.usage?.prompt_tokens);
    const outputTokens = usageTokens(value.usage?.completion_tokens);
    if (choice?.finish_reason !== 'stop') return { kind: 'unreadable', inputTokens, outputTokens };
    const content = choice.message?.content;
    if (typeof content !== 'string') return { kind: 'unreadable', inputTokens, outputTokens };
    const candidate = content.trim();
    if (!REFERENCE.test(candidate)) return { kind: 'unreadable', inputTokens, outputTokens };
    return { kind: 'candidate', reference: candidate.toUpperCase(), inputTokens, outputTokens };
  } catch {
    // API error bodies and customer image contents must never enter application logs.
    return { kind: 'unavailable' };
  }
}
