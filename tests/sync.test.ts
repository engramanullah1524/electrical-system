import { describe, expect, it, vi } from 'vitest';
import { buildRequest, fromBase64, ping, toBase64 } from '../src/sync/appsScript';

const config = { url: 'https://script.google.com/macros/s/EXAMPLE_ID/exec', token: 'example-token' };

describe('buildRequest', () => {
  it('sends a text/plain POST so the browser needs no CORS preflight', () => {
    const { url, init } = buildRequest(config, 'ping');
    expect(url).toBe(config.url);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
  });

  it('keeps the token in the body, never the URL', () => {
    const { url, init } = buildRequest(config, 'ping');
    expect(url).not.toContain('example-token');
    expect(JSON.parse(String(init.body))).toMatchObject({ token: 'example-token', op: 'ping' });
  });

  it('defaults to an empty project so no tracker tab is created or renamed', () => {
    const body = JSON.parse(String(buildRequest(config, 'ping').init.body));
    expect(body).toMatchObject({ project: '', projectId: '' });
  });

  it('rejects anything but a deployed /exec URL, and a blank token', () => {
    expect(() => buildRequest({ ...config, url: 'https://script.google.com/macros/s/EXAMPLE_ID/dev' }, 'ping')).toThrow('/exec');
    expect(() => buildRequest({ ...config, url: 'https://example.org/exec' }, 'ping')).toThrow('/exec');
    expect(() => buildRequest({ ...config, token: '  ' }, 'ping')).toThrow('token');
  });
});

describe('ping', () => {
  it('returns the reply when the script accepts', async () => {
    const reply = { ok: true, sheet: 'Tracker', rowCount: 3, scriptVersion: 5 };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(reply)));
    await expect(ping(config, fetchImpl)).resolves.toEqual(reply);
  });

  it("surfaces the script's own error, e.g. a wrong token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Token does not match' })));
    await expect(ping(config, fetchImpl)).rejects.toThrow('Token does not match');
  });

  it('explains a network failure in plain words', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(ping(config, fetchImpl)).rejects.toThrow('Could not reach the sync script');
  });
});

describe('base64', () => {
  it('round-trips binary data larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
