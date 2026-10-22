import { describe, expect, it, vi } from 'vitest';

import {
  DIGITALOCEAN_SCREENSHOT_MODEL,
  readDigitalOceanScreenshotReference,
} from './digitalocean-screenshot-reference.js';

const image = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const dependencies = { modelAccessKey: 'synthetic-key' };

function completion(content: unknown, promptTokens = 100, completionTokens = 12): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content } }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    }),
  );
}

describe('DigitalOcean screenshot reference candidate reader', () => {
  it('sends only one bounded image request to the fixed DigitalOcean endpoint', async () => {
    const fetch = vi.fn(
      async (_url: Parameters<typeof globalThis.fetch>[0], _options?: RequestInit) =>
        completion('cbe12345678'),
    );
    const result = await readDigitalOceanScreenshotReference(image, 'image/jpeg', {
      ...dependencies,
      fetch,
    });
    expect(result).toEqual({
      kind: 'candidate',
      reference: 'CBE12345678',
      inputTokens: 100,
      outputTokens: 12,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://inference.do-ai.run/v1/chat/completions');
    const request = options as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe(DIGITALOCEAN_SCREENSHOT_MODEL);
    expect(body.max_tokens).toBe(1024);
    expect(body.messages[0].content[1].image_url.url).toBe(
      `data:image/jpeg;base64,${image.toString('base64')}`,
    );
  });

  it('withholds unclear, verbose, wrong-length, and no-digit output', async () => {
    for (const output of ['UNREADABLE', 'Maybe CBE12345678', 'ABC123', 'ABCDEFGHIJK']) {
      const result = await readDigitalOceanScreenshotReference(image, 'image/jpeg', {
        ...dependencies,
        fetch: async () => completion(output),
      });
      expect(result.kind).toBe('unreadable');
    }
  });

  it('withholds a reference from a truncated model response', async () => {
    for (const content of ['CBE12345678', null]) {
      const result = await readDigitalOceanScreenshotReference(image, 'image/png', {
        ...dependencies,
        fetch: async () =>
          new Response(
            JSON.stringify({ choices: [{ finish_reason: 'length', message: { content } }] }),
          ),
      });
      expect(result.kind).toBe('unreadable');
    }
  });

  it('does not expose an API failure or its body', async () => {
    const result = await readDigitalOceanScreenshotReference(image, 'image/png', {
      ...dependencies,
      fetch: async () => new Response('private upstream response', { status: 503 }),
    });
    expect(result).toEqual({ kind: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private upstream response');
  });
});
