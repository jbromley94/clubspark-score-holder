import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import HttpError from './httpError';

const MAX_BODY_BYTES = 8192;

/** Reads a bounded JSON payload; untrusted HTTP data is validated before reaching the class. */
export default async function readScore(request: IncomingMessage): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type']))) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }

  const chunks: Buffer[] = [];
  let bytes = 0;

  // The unmodified IncomingMessage yields Buffers. Retain the socket on early exit so
  // an oversized upload receives a 413 response rather than only a connection reset.
  const body = request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>;
  for await (const chunk of body) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body exceeds 8192 bytes');
    }
    chunks.push(chunk);
  }

  let payload: unknown;
  try {
    // Reject invalid UTF-8 instead of silently replacing bytes inside a stored score.
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    payload = JSON.parse(json);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('score' in payload) ||
    typeof payload.score !== 'string'
  ) {
    throw new HttpError(400, 'Body must be an object with a string score');
  }

  return payload.score;
}
