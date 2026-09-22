import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScoreServer } from '../helpers/scoreServer';

let app: Awaited<ReturnType<typeof startScoreServer>>;
let closeStreams: Array<() => Promise<void>>;
beforeEach(async () => {
  app = await startScoreServer();
  closeStreams = [];
});
afterEach(async () => {
  await Promise.all(closeStreams.map((close) => close()));
  await app.close();
  vi.restoreAllMocks();
});

async function connect(match: string) {
  const response = await fetch(`${app.baseUrl}/matches/${encodeURIComponent(match)}/events`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  if (!response.body) throw new Error('Expected an SSE body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const stream = {
    // HTTP chunks can split a frame or contain several frames. Parse the actual SSE boundary.
    next: async () => {
      while (!buffer.includes('\n\n')) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Stream closed before the next frame');
        buffer += decoder.decode(value, { stream: true });
      }
      const end = buffer.indexOf('\n\n');
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return frame;
    },
    close: () => reader.cancel(),
  };
  closeStreams.push(stream.close);
  expect(await stream.next()).toBe(': connected');
  return stream;
}

test('delivers future HTTP publications to two spectators in order', async () => {
  app.holder.putScore('M1', 'old score');
  const [first, second] = await Promise.all([connect('M1'), connect('M1')]);
  for (const score of ['15-0', '30-0', '30-0']) {
    const response = await app.publish('M1', score);
    expect(response.status).toBe(201);
    await response.json();
    const frame = `event: score\ndata: ${JSON.stringify({ match: 'M1', score })}`;
    expect(await first.next()).toBe(frame);
    expect(await second.next()).toBe(frame);
  }
});

test('isolates matches and safely frames Unicode, newlines and empty scores', async () => {
  const match = '场 / M1\n';
  const first = await connect(match);
  const second = await connect('M2');
  const score = '15-0\n\nevent: fake\r\ndata: "你好"';
  app.holder.putScore('M2', '');
  app.holder.putScore(match, score);
  expect(await first.next()).toBe(`event: score\ndata: ${JSON.stringify({ match, score })}`);
  expect(await second.next()).toBe('event: score\ndata: {"match":"M2","score":""}');
});

test('preserves publication order when another subscriber publishes reentrantly', async () => {
  app.holder.subscribe('M1', (score) => {
    if (score === '15-0') app.holder.putScore('M1', '30-0');
  });
  const spectator = await connect('M1');
  app.holder.putScore('M1', '15-0');
  expect(await spectator.next()).toBe('event: score\ndata: {"match":"M1","score":"15-0"}');
  expect(await spectator.next()).toBe('event: score\ndata: {"match":"M1","score":"30-0"}');
});

test('unsubscribes on disconnect and keeps other spectators connected', async () => {
  const originalSubscribe = app.holder.subscribe.bind(app.holder);
  const cancelled = new Promise<void>((resolve) => {
    vi.spyOn(app.holder, 'subscribe').mockImplementationOnce((match, listener) => {
      const unsubscribe = originalSubscribe(match, listener);
      return () => {
        unsubscribe();
        resolve();
      };
    });
  });
  const first = await connect('M1');
  const second = await connect('M1');
  await first.close();
  await cancelled;
  app.holder.putScore('M1', '40-0');
  expect(await second.next()).toBe('event: score\ndata: {"match":"M1","score":"40-0"}');
});

test('emits keepalive comments while there are no scores', async () => {
  await app.close();
  app = await startScoreServer({ heartbeatIntervalMs: 20 });
  const spectator = await connect('M1');
  expect(await spectator.next()).toBe(': heartbeat');
});

test('sanitizes subscription setup failures before sending streaming headers', async () => {
  vi.spyOn(app.holder, 'subscribe').mockImplementationOnce(() => {
    throw new Error('private details');
  });
  const response = await fetch(`${app.baseUrl}/matches/M1/events`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error' });
});
