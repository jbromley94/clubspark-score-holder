import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { IScoreHolder } from '../interfaces/scoreHolder';
import type { IScoreServerOptions } from '../interfaces/scoreServer';
import HttpError from './httpError';
import readScore from './readScore';
import sendJson from './sendJson';
import streamScores from './streamScores';
import waitForScore from './waitForScore';

/**
 * Creates an unstarted HTTP server. The injected holder is shared by every request.
 * Call listen on the returned server; close it when the owning application shuts down.
 */
export function createScoreServer(
  scoreHolder: IScoreHolder,
  options: IScoreServerOptions = {},
): Server {
  const waitTimeoutMs = options.waitTimeoutMs ?? 30000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
  if (
    [waitTimeoutMs, heartbeatIntervalMs].some(
      (interval) => !Number.isSafeInteger(interval) || interval < 1 || interval > 2147483647,
    )
  ) {
    throw new RangeError('Server intervals must be integers between 1 and 2147483647 ms');
  }
  return createServer(
    { requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 },
    (request, response) => {
      // Node's request event does not await promises, so handle rejections explicitly.
      void handleRequest(scoreHolder, request, response, waitTimeoutMs, heartbeatIntervalMs).catch(
        (error: unknown) => {
          if (response.destroyed) {
            return;
          }
          if (response.headersSent) {
            response.destroy();
            return;
          }

          // Rejected uploads may still have unread bytes. Close after sending the error.
          response.setHeader('Connection', 'close');
          if (error instanceof HttpError) {
            sendJson(response, error.statusCode, { error: error.message });
          } else {
            sendJson(response, 500, { error: 'Internal server error' });
          }
        },
      );
    },
  );
}

async function handleRequest(
  scoreHolder: IScoreHolder,
  request: IncomingMessage,
  response: ServerResponse,
  waitTimeoutMs: number,
  heartbeatIntervalMs: number,
): Promise<void> {
  if (request.url === '/health') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      throw new HttpError(405, 'Method not allowed');
    }

    sendJson(response, 200, { status: 'ok' });
    return;
  }

  const route = /^\/matches\/([^/?]+)\/(score|history|next|events)(?:\?.*)?$/.exec(
    String(request.url),
  );
  const rawMatch = route?.[1];
  if (!rawMatch) {
    throw new HttpError(404, 'Route not found');
  }

  let match: string;
  try {
    match = decodeURIComponent(rawMatch);
  } catch {
    throw new HttpError(400, 'Invalid match encoding');
  }

  const resource = route[2];
  const allowedMethods = resource === 'score' ? ['GET', 'POST'] : ['GET'];
  if (!allowedMethods.includes(String(request.method))) {
    response.setHeader('Allow', allowedMethods.join(', '));
    throw new HttpError(405, 'Method not allowed');
  }
  if (resource === 'history') {
    sendJson(response, 200, { match, scores: scoreHolder.getHistory(match) });
    return;
  }
  if (resource === 'next') {
    await waitForScore(scoreHolder, match, response, waitTimeoutMs);
    return;
  }
  if (resource === 'events') {
    streamScores(scoreHolder, match, response, heartbeatIntervalMs);
    return;
  }

  if (request.method === 'GET') {
    const score = scoreHolder.getScore(match);
    if (score === undefined) {
      throw new HttpError(404, 'Score not found');
    }
    sendJson(response, 200, { match, score });
    return;
  }

  const score = await readScore(request);
  let notificationErrors: number | undefined;
  try {
    scoreHolder.putScore(match, score);
  } catch (error) {
    if (!(error instanceof AggregateError)) {
      throw error;
    }
    // The contract says storage succeeded. Do not encourage retries by reporting failure.
    notificationErrors = error.errors.length;
  }

  response.setHeader('Location', `/matches/${encodeURIComponent(match)}/score`);
  sendJson(response, 201, { match, score, notificationErrors });
}
