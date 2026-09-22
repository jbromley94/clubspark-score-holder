import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScoreServer } from '../helpers/scoreServer';

let app: Awaited<ReturnType<typeof startScoreServer>>;
beforeEach(async () => {
  app = await startScoreServer();
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

test('encodes match identifiers and leaves other histories independent', async () => {
  const match = '场 / court';
  app.holder.putScore(match, '15-0');
  const response = await fetch(
    `${app.baseUrl}/matches/${encodeURIComponent(match)}/history?view=all`,
  );
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ match, scores: ['15-0'] });
  expect(app.holder.getHistory('M1')).toEqual([]);
});

test.each(['history', 'next', 'events'])('allows only GET for %s', async (resource) => {
  const response = await fetch(`${app.baseUrl}/matches/M1/${resource}`, { method: 'POST' });
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('GET');
  expect(await response.json()).toEqual({ error: 'Method not allowed' });
});

test('sanitizes an unexpected history failure', async () => {
  vi.spyOn(app.holder, 'getHistory').mockImplementationOnce(() => {
    throw new Error('private details');
  });
  const response = await fetch(`${app.baseUrl}/matches/M1/history`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error' });
});

test('returns bounded history in publication order for the requested match', async () => {
  for (const score of ['0-0', '15-0', '30-0']) app.holder.putScore('M1', score);
  app.holder.putScore('M2', '0-40');
  const response = await fetch(`${app.baseUrl}/matches/M1/history`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ match: 'M1', scores: ['15-0', '30-0'] });
});

test('returns an empty history for a match without publications', async () => {
  const response = await fetch(`${app.baseUrl}/matches/new/history`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ match: 'new', scores: [] });
});
