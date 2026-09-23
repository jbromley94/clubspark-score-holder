import { Buffer } from 'node:buffer';
import type { ServerResponse } from 'node:http';
import type { IScoreHolder } from '../interfaces/scoreHolder';
import type { Unsubscribe } from '../types/scoreHolder';

const MAX_BUFFER_BYTES = 64 * 1024;

/** Streams future publications. Slow clients are disconnected instead of accumulating a queue. */
export default function streamScores(
  holder: IScoreHolder,
  match: string,
  response: ServerResponse,
  heartbeatIntervalMs: number,
): void {
  let closed = false;
  let unsubscribe: Unsubscribe | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe?.();
    response.off('close', cleanup).off('error', disconnect);
  };
  const disconnect = (): void => {
    cleanup();
    response.destroy();
  };
  const write = (frame: string): void => {
    if (closed) return;
    if (response.destroyed || response.writableEnded) {
      cleanup();
      return;
    }
    // Include already-buffered bytes and reject an oversized event before writing it.
    if (response.writableLength + Buffer.byteLength(frame) > MAX_BUFFER_BYTES) {
      disconnect();
      return;
    }
    try {
      if (!response.write(frame)) disconnect();
    } catch {
      // Transport failure belongs to this client, not to the score producer.
      disconnect();
    }
  };

  response.once('close', cleanup).once('error', disconnect);
  try {
    unsubscribe = holder.subscribe(match, (score) => {
      // JSON escapes newlines in identifiers and scores, preserving SSE frame boundaries.
      write(`event: score\ndata: ${JSON.stringify({ match, score })}\n\n`);
    });
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    // This comment flushes headers and lets terminal clients see that they are connected.
    write(': connected\n\n');
    if (!closed) {
      heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatIntervalMs).unref();
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}
