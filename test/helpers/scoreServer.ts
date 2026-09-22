import { once } from 'node:events';
import type { IScoreServerOptions } from '../../src/interfaces/scoreServer';
import ScoreHolder from '../../src/scoreHolder';
import { createScoreServer } from '../../src/server/scoreServer';

/** A real server per test keeps connection lifecycle checks independent. */
export async function startScoreServer(options?: IScoreServerOptions) {
  const holder = new ScoreHolder(2);
  const server = createScoreServer(holder, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    holder,
    server,
    baseUrl,
    publish: (match: string, score: string) =>
      fetch(`${baseUrl}/matches/${encodeURIComponent(match)}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
