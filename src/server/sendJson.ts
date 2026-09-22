import { Buffer } from 'node:buffer';
import type { ServerResponse } from 'node:http';

/** Shared JSON response formatting, including UTF-8 byte length and cache policy. */
export default function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  response.end(json);
}
