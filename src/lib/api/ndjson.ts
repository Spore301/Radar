// ---------------------------------------------------------------------------
// Server-side NDJSON streaming for long-running route handlers.
//
// A route that does several seconds of work (parsing a JD through DeepSeek,
// running 16 SERP queries) streams one JSON object per line as it progresses,
// so the dashboard's overlay can show a real progress bar and status line
// instead of a spinner. The final line is always `{type:'done', payload}` or
// `{type:'error', error}`; the client helper in stream.ts resolves on it.
//
// Auth and validation failures must still be returned as ordinary JSON
// *before* calling this — once the stream starts, the HTTP status is 200.
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { type: 'stage'; key: string; label: string; index?: number; total?: number }
  | { type: 'start'; total: number }
  | { type: 'query_start'; queryId: string; platform: string; queryType: string; index: number; total: number }
  | { type: 'query_done'; result: unknown; done: number; total: number; indexedSoFar: number }
  | { type: 'done'; payload: unknown }
  | { type: 'error'; error: string };

export type Emit = (event: ProgressEvent) => void;

/**
 * Runs `producer` and streams every event it emits. The producer's return
 * value becomes the `done` payload; a thrown error becomes the `error` line.
 */
export function ndjsonResponse(producer: (emit: Emit) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          closed = true;
        }
      };
      (async () => {
        try {
          const payload = await producer(write);
          write({ type: 'done', payload });
        } catch (err: any) {
          console.error('Streaming route failed:', err);
          write({ type: 'error', error: err?.message || 'Unexpected server error' });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // Already closed by the client disconnecting.
            }
          }
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Tell reverse proxies (nginx) not to buffer, or progress arrives all at once.
      'X-Accel-Buffering': 'no',
    },
  });
}
