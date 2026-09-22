import { once } from 'node:events';
import { type IncomingMessage, request, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ScoreHolder from '../../src/scoreHolder';
import { createScoreServer } from '../../src/server/scoreServer';

describe('HTTP score adapter', () => {
  let scoreHolder: ScoreHolder;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    scoreHolder = new ScoreHolder(2);
    server = createScoreServer(scoreHolder);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The test server did not obtain a TCP address');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
      server.closeAllConnections();
    });
  });

  const publish = (match: string, score: string) =>
    fetch(`${baseUrl}/matches/${encodeURIComponent(match)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    });

  test('publishes a score and retrieves it from the same injected holder', async () => {
    const published = await publish('M1', '15-0');

    expect(published.status).toBe(201);
    expect(published.headers.get('location')).toBe('/matches/M1/score');
    expect(published.headers.get('cache-control')).toBe('no-store');
    expect(published.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await published.json()).toEqual({ match: 'M1', score: '15-0' });
    expect(scoreHolder.getScore('M1')).toBe('15-0');

    const retrieved = await fetch(`${baseUrl}/matches/M1/score`);

    expect(retrieved.status).toBe(200);
    expect(retrieved.headers.get('cache-control')).toBe('no-store');
    expect(retrieved.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await retrieved.json()).toEqual({ match: 'M1', score: '15-0' });
  });

  test('reads scores published directly through the shared holder', async () => {
    scoreHolder.putScore('M1', '30-15');

    const response = await fetch(`${baseUrl}/matches/M1/score`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ match: 'M1', score: '30-15' });
  });

  test('returns 404 for a match with no published score', async () => {
    const response = await fetch(`${baseUrl}/matches/unknown/score`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Score not found' });
  });

  test('keeps concurrent producers and consumers for different matches independent', async () => {
    const responses = await Promise.all([publish('M1', '15-0'), publish('M2', '30-40')]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    await Promise.all(responses.map((response) => response.json()));
    const scores = await Promise.all(
      ['M1', 'M2'].map(async (match) => {
        const response = await fetch(`${baseUrl}/matches/${match}/score`);
        return response.json();
      }),
    );

    expect(scores).toEqual([
      { match: 'M1', score: '15-0' },
      { match: 'M2', score: '30-40' },
    ]);
  });

  test('publishes each update through the core, preserving bounded history and notifications', async () => {
    const received: string[] = [];
    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });
    const nextScore = scoreHolder.waitForNextScore('M1');

    for (const score of ['0-0', '15-0', '15-0']) {
      const response = await publish('M1', score);
      expect(response.status).toBe(201);
      await response.json();
    }

    await expect(nextScore).resolves.toBe('0-0');
    expect(received).toEqual(['0-0', '15-0', '15-0']);
    expect(scoreHolder.getHistory('M1')).toEqual(['15-0', '15-0']);
    const latest = await fetch(`${baseUrl}/matches/M1/score`);
    expect(await latest.json()).toEqual({ match: 'M1', score: '15-0' });
  });

  test('supports encoded match identifiers and ignores query parameters', async () => {
    const match = '第1场 / centre court';
    const published = await publish(match, '15-0');

    expect(published.status).toBe(201);
    expect(published.headers.get('location')).toBe(`/matches/${encodeURIComponent(match)}/score`);
    expect(await published.json()).toEqual({ match, score: '15-0' });
    const retrieved = await fetch(
      `${baseUrl}/matches/${encodeURIComponent(match)}/score?view=latest`,
    );
    expect(await retrieved.json()).toEqual({ match, score: '15-0' });
  });

  test('preserves an empty score as a valid stored value', async () => {
    const published = await publish('M1', '');
    expect(published.status).toBe(201);
    expect(await published.json()).toEqual({ match: 'M1', score: '' });

    const retrieved = await fetch(`${baseUrl}/matches/M1/score`);
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toEqual({ match: 'M1', score: '' });
  });

  test('accepts case-insensitive JSON media types and optional parameters', async () => {
    const response = await fetch(`${baseUrl}/matches/M1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'Application/JSON; charset=utf-8' },
      body: JSON.stringify({ score: '15-0' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ match: 'M1', score: '15-0' });
  });

  test.each(['/', '/matches', '/matches//score', '/matches/M1/unknown', '/matches/M1/score/'])(
    'rejects an unknown route: %s',
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Route not found' });
    },
  );

  test.each(['%ZZ', '%E0%A4%A'])('rejects invalid match encoding: %s', async (match) => {
    const response = await fetch(`${baseUrl}/matches/${match}/score`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid match encoding' });
  });

  test('reports the allowed methods for a recognized route', async () => {
    const response = await fetch(`${baseUrl}/matches/M1/score`, { method: 'DELETE' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });

  test.each([undefined, 'text/plain', 'application/jsonp'])(
    'rejects a missing or unsupported media type: %s',
    async (mediaType) => {
      const response = await fetch(`${baseUrl}/matches/M1/score`, {
        method: 'POST',
        headers: mediaType === undefined ? {} : { 'Content-Type': mediaType },
        body: Buffer.from(JSON.stringify({ score: '15-0' })),
      });

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: 'Content-Type must be application/json' });
      expect(scoreHolder.getScore('M1')).toBeUndefined();
    },
  );

  test.each(['', '{', '{"score":}'])('rejects malformed JSON: %s', async (body) => {
    const response = await fetch(`${baseUrl}/matches/M1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON' });
    expect(scoreHolder.getScore('M1')).toBeUndefined();
  });

  test('rejects malformed UTF-8 without storing replacement characters as the score', async () => {
    const body = Buffer.concat([
      Buffer.from('{"score":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]);
    const response = await fetch(`${baseUrl}/matches/M1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON' });
    expect(scoreHolder.getScore('M1')).toBeUndefined();
  });

  test.each([null, [], {}, { score: 15 }, { score: null }, '15-0', true])(
    'rejects a JSON value without a string score: %j',
    async (body) => {
      const response = await fetch(`${baseUrl}/matches/M1/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Body must be an object with a string score',
      });
      expect(scoreHolder.getScore('M1')).toBeUndefined();
    },
  );

  test('accepts a multibyte JSON payload exactly at the 8192-byte limit', async () => {
    const score = 'é'.repeat(4090);
    expect(Buffer.byteLength(JSON.stringify({ score }))).toBe(8192);

    const response = await publish('M1', score);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ match: 'M1', score });
  });

  test('rejects a payload one byte beyond the limit without storing it', async () => {
    const score = `${'é'.repeat(4090)}a`;
    expect(Buffer.byteLength(JSON.stringify({ score }))).toBe(8193);

    const response = await publish('M1', score);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request body exceeds 8192 bytes' });
    expect(scoreHolder.getScore('M1')).toBeUndefined();
  });

  test('reports subscriber failures without suggesting the stored publication failed', async () => {
    const received: string[] = [];
    scoreHolder.subscribe('M1', () => {
      throw new Error('private subscriber details');
    });
    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });
    scoreHolder.subscribe('M1', () => {
      throw new Error('another private subscriber failure');
    });

    const response = await publish('M1', '15-0');

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ match: 'M1', score: '15-0', notificationErrors: 2 });
    expect(received).toEqual(['15-0']);
    const retrieved = await fetch(`${baseUrl}/matches/M1/score`);
    expect(await retrieved.json()).toEqual({ match: 'M1', score: '15-0' });
  });

  test('does not expose unexpected read failures', async () => {
    vi.spyOn(scoreHolder, 'getScore').mockImplementationOnce(() => {
      throw new Error('private storage details');
    });

    const response = await fetch(`${baseUrl}/matches/M1/score`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  test('does not expose unexpected publication failures', async () => {
    vi.spyOn(scoreHolder, 'putScore').mockImplementationOnce(() => {
      throw new Error('private producer details');
    });

    const response = await publish('M1', '15-0');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(scoreHolder.getScore('M1')).toBeUndefined();
  });

  test('discards an interrupted upload and continues serving subsequent requests', async () => {
    // Coordinate on actual request data, so cancellation cannot precede the upload.
    const incoming = new Promise<IncomingMessage>((resolve) => {
      server.once('request', (message) => {
        message.once('data', () => resolve(message));
      });
    });
    const client = request(`${baseUrl}/matches/M1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const clientClosed = new Promise<void>((resolve) => {
      client.once('error', () => resolve());
    });
    client.write('{"score":"15-');
    const message = await incoming;
    const aborted = new Promise<void>((resolve) => {
      message.once('aborted', () => resolve());
    });
    client.destroy();
    await Promise.all([aborted, clientClosed]);

    const missing = await fetch(`${baseUrl}/matches/M1/score`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Score not found' });
    expect(scoreHolder.getHistory('M1')).toEqual([]);

    const successful = await publish('M1', '15-0');
    expect(successful.status).toBe(201);
    expect(await successful.json()).toEqual({ match: 'M1', score: '15-0' });
  });
});
