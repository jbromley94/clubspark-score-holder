import { get } from 'node:http';
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

test('completes several waiting HTTP consumers from one HTTP publication', async () => {
  const originalWait = app.holder.waitForNextScore.bind(app.holder);
  let count = 0;
  const registered = new Promise<void>((resolve) => {
    vi.spyOn(app.holder, 'waitForNextScore').mockImplementation((match, signal) => {
      const result = originalWait(match, signal);
      count += 1;
      if (count === 3) resolve();
      return result;
    });
  });
  const waiting = [1, 2, 3].map(() => fetch(`${app.baseUrl}/matches/M1/next`));
  await registered;
  const publication = await app.publish('M1', '15-0');
  expect(publication.status).toBe(201);
  await publication.json();
  for (const result of await Promise.all(waiting)) {
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ match: 'M1', score: '15-0' });
  }
});

test('cancels only the disconnected request and still serves another waiter', async () => {
  const originalWait = app.holder.waitForNextScore.bind(app.holder);
  const cancelled = new Promise<void>((resolveCancelled) => {
    vi.spyOn(app.holder, 'waitForNextScore').mockImplementationOnce((match, signal) => {
      const result = originalWait(match, signal);
      signal?.addEventListener('abort', () => resolveCancelled(), { once: true });
      return result;
    });
  });
  const registered = new Promise<void>((resolve) => app.server.once('request', () => resolve()));
  const client = get(`${app.baseUrl}/matches/M1/next`);
  const clientClosed = new Promise<void>((resolve) => client.once('error', () => resolve()));
  await registered;
  client.destroy();
  await Promise.all([cancelled, clientClosed]);

  app.server.once('request', () => app.holder.putScore('M1', '30-0'));
  const response = await fetch(`${app.baseUrl}/matches/M1/next`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ match: 'M1', score: '30-0' });
});

test('returns an empty 204 when the server-owned waiting deadline expires', async () => {
  await app.close();
  app = await startScoreServer({ waitTimeoutMs: 20 });
  const response = await fetch(`${app.baseUrl}/matches/M1/next?timeout=999999`);
  expect(response.status).toBe(204);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('');
});

test('reports unexpected waiting failures as a sanitized 500', async () => {
  vi.spyOn(app.holder, 'waitForNextScore').mockRejectedValueOnce(new Error('private details'));
  const response = await fetch(`${app.baseUrl}/matches/M1/next`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error' });
});

test('waits for a future publication instead of replaying the current score', async () => {
  app.holder.putScore('M1', '0-0');
  // This listener runs after the adapter has handled the incoming request.
  app.server.once('request', () => {
    app.holder.putScore('M2', '0-40');
    app.holder.putScore('M1', '15-0');
    app.holder.putScore('M1', '30-0');
  });
  const response = await fetch(`${app.baseUrl}/matches/M1/next`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ match: 'M1', score: '15-0' });
});
