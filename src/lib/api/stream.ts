import type { ProgressEvent } from './ndjson';

export type { ProgressEvent };

// ---------------------------------------------------------------------------
// Browser-side reader for the NDJSON routes (see ndjson.ts). Calls `onEvent`
// for every progress line and resolves with the `done` payload. A JSON error
// response returned before the stream started (401, 400, 404) is surfaced as
// a thrown Error, as is an `error` line or a stream that ends without `done`.
// ---------------------------------------------------------------------------

export async function postNdjson<T>(
  url: string,
  init: RequestInit,
  onEvent?: (event: ProgressEvent) => void
): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('ndjson')) {
    // Plain JSON: either a pre-stream error, or a server that doesn't stream.
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // fallthrough
    }
    if (!res.ok || (data && data.success === false)) {
      throw new Error(data?.error || `${init.method ?? 'GET'} ${url} failed with ${res.status}`);
    }
    return data as T;
  }

  if (!res.body) throw new Error('The server returned an empty stream.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload: T | undefined;
  let sawDone = false;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: ProgressEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return; // ignore a torn line
    }
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'done') {
      sawDone = true;
      donePayload = event.payload as T;
      return;
    }
    onEvent?.(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleLine(buffer);

  if (!sawDone) throw new Error('The connection closed before the server finished.');
  return donePayload as T;
}
