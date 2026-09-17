/**
 * Client for the Site Tasks Sync Apps Script web app, which is reused unchanged.
 *
 * Requests are sent as text/plain, so the browser needs no CORS preflight; the script parses the
 * body as JSON whatever its type. The token travels only in the body, never in the URL.
 */
export interface SyncConfig {
  url: string;
  token: string;
}

export interface PingReply {
  ok: true;
  sheet: string;
  rowCount: number;
  scriptVersion?: number;
  tab?: string;
}

export interface DownloadReply {
  ok: true;
  name: string;
  mimeType: string;
  data: string;
}

const EXEC_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

export function buildRequest(config: SyncConfig, op: string, body: Record<string, unknown> = {}) {
  const url = config.url.trim();
  if (!EXEC_URL.test(url)) throw new Error('Paste the Web app URL that ends in /exec.');
  const token = config.token.trim();
  if (!token) throw new Error('Enter the sync token.');

  // An empty project keeps every row operation on the tracker's default tab, so nothing here can
  // create or rename a tab that Site Tasks or the Daily Report depends on.
  const payload = { token, op, project: '', projectId: '', ...body };
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  };
  return { url, init };
}

export async function callScript<T>(
  config: SyncConfig,
  op: string,
  body?: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const { url, init } = buildRequest(config, op, body);
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new Error('Could not reach the sync script: no internet, a wrong URL, or the reply was blocked.');
  }
  if (!response.ok) throw new Error(`The sync script answered HTTP ${response.status}.`);
  const reply = (await response.json()) as { ok: boolean; error?: string };
  if (!reply.ok) throw new Error(reply.error ?? 'The sync script refused the request.');
  return reply as T;
}

export function ping(config: SyncConfig, fetchImpl?: typeof fetch): Promise<PingReply> {
  return callScript<PingReply>(config, 'ping', {}, fetchImpl);
}

/** Stores a file in Drive under the given folder name; the script replaces a file of the same name. */
export function uploadFile(
  config: SyncConfig,
  folder: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; fileId: string; url: string }> {
  return callScript(config, 'attachUpload', { project: folder, name, mimeType, data: toBase64(bytes) }, fetchImpl);
}

export async function downloadFile(config: SyncConfig, fileId: string, fetchImpl?: typeof fetch) {
  const reply = await callScript<DownloadReply>(config, 'attachDownload', { fileId }, fetchImpl);
  return { name: reply.name, mimeType: reply.mimeType, bytes: fromBase64(reply.data) };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
