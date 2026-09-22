import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

/** Real response state, without a TCP connection, for deterministic transport fault tests. */
export function createResponse() {
  const request = new IncomingMessage(new Socket());
  request.method = 'GET';
  return { request, response: new ServerResponse(request) };
}
