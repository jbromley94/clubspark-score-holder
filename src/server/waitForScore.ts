import type { ServerResponse } from 'node:http';
import type { IScoreHolder } from '../interfaces/scoreHolder';
import sendJson from './sendJson';

/** One HTTP request owns one cancellable core wait and one deadline. */
export default async function waitForScore(
  holder: IScoreHolder,
  match: string,
  response: ServerResponse,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeoutReason = new Error('HTTP wait expired');
  const disconnect = (): void => {
    response.destroy();
    controller.abort();
  };
  // IncomingMessage's close also occurs when a request body completes normally.
  // The response's close tells us whether this waiting client has gone away.
  response.once('close', disconnect).once('error', disconnect);
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs).unref();

  try {
    const score = await holder.waitForNextScore(match, controller.signal);
    if (!response.destroyed) {
      sendJson(response, 200, { match, score });
    }
  } catch (error) {
    if (response.destroyed) {
      return;
    }
    if (error === timeoutReason) {
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    response.off('close', disconnect).off('error', disconnect);
  }
}
