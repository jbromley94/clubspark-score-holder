import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ScoreHolder from '../../src/scoreHolder';
import streamScores from '../../src/server/streamScores';
import { createResponse } from '../helpers/httpResponse';

let holder: ScoreHolder;
let response: ReturnType<typeof createResponse>['response'];
beforeEach(() => {
  vi.useFakeTimers();
  holder = new ScoreHolder();
  response = createResponse().response;
  vi.spyOn(response, 'write').mockReturnValue(true);
});
afterEach(() => {
  response.emit('close');
  expect(vi.getTimerCount()).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
  expect(response.listenerCount('error')).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('writes periodic comments and stops them on disconnect', async () => {
  streamScores(holder, 'M1', response, 15000);
  expect(response.write).toHaveBeenCalledExactlyOnceWith(': connected\n\n');
  await vi.advanceTimersByTimeAsync(15000);
  expect(response.write).toHaveBeenLastCalledWith(': heartbeat\n\n');
  response.emit('close');
  await vi.advanceTimersByTimeAsync(30000);
  expect(response.write).toHaveBeenCalledTimes(2);
});

test('disconnects on write backpressure without interrupting other subscribers', () => {
  const healthy: string[] = [];
  streamScores(holder, 'M1', response, 15000);
  holder.subscribe('M1', (score) => {
    healthy.push(score);
  });
  vi.mocked(response.write).mockReturnValueOnce(false);
  expect(() => holder.putScore('M1', '15-0')).not.toThrow();
  expect(response.destroyed).toBe(true);
  holder.putScore('M1', '30-0');
  expect(healthy).toEqual(['15-0', '30-0']);
  expect(holder.getScore('M1')).toBe('30-0');
  expect(response.write).toHaveBeenCalledTimes(2);
});

test('does not start a heartbeat if the initial connection write is already blocked', () => {
  vi.mocked(response.write).mockReturnValueOnce(false);
  streamScores(holder, 'M1', response, 15000);
  expect(response.destroyed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('accepts exactly 64 KiB of UTF-8 event data and rejects the next byte', () => {
  streamScores(holder, 'M1', response, 15000);
  const overhead = Buffer.byteLength('event: score\ndata: {"match":"M1","score":""}\n\n');
  const space = 65536 - overhead;
  const score = 'é'.repeat(Math.floor(space / 2)) + 'x'.repeat(space % 2);
  holder.putScore('M1', score);
  expect(response.destroyed).toBe(false);
  expect(response.write).toHaveBeenLastCalledWith(
    `event: score\ndata: ${JSON.stringify({ match: 'M1', score })}\n\n`,
  );
  holder.putScore('M1', `${score}x`);
  expect(response.destroyed).toBe(true);
  expect(response.write).toHaveBeenCalledTimes(2);
});

test('counts existing buffered bytes before accepting another event', () => {
  streamScores(holder, 'M1', response, 15000);
  vi.spyOn(response, 'writableLength', 'get').mockReturnValue(65530);
  holder.putScore('M1', '15-0');
  expect(response.destroyed).toBe(true);
  expect(response.write).toHaveBeenCalledTimes(1);
});

test('isolates a synchronous transport write failure from the producer', () => {
  streamScores(holder, 'M1', response, 15000);
  vi.mocked(response.write).mockImplementationOnce(() => {
    throw new Error('connection lost');
  });
  expect(() => holder.putScore('M1', '15-0')).not.toThrow();
  expect(response.destroyed).toBe(true);
  expect(holder.getScore('M1')).toBe('15-0');
});

test('destroys the response and cancels subscriptions on an asynchronous transport error', () => {
  streamScores(holder, 'M1', response, 15000);
  response.emit('error', new Error('socket failure'));
  holder.putScore('M1', '15-0');
  expect(response.destroyed).toBe(true);
  expect(response.write).toHaveBeenCalledTimes(1);
});

test.each(['destroyed', 'ended'])('stops writing when the response is already %s', (state) => {
  streamScores(holder, 'M1', response, 15000);
  if (state === 'destroyed') response.destroy();
  else response.end();
  holder.putScore('M1', '15-0');
  expect(response.write).toHaveBeenCalledTimes(1);
});

test('makes cleanup idempotent and ignores callbacks retained before cancellation', () => {
  const subscribe = vi.spyOn(holder, 'subscribe');
  streamScores(holder, 'M1', response, 15000);
  const listener = subscribe.mock.calls[0]?.[1];
  const cleanup = response.listeners('close')[0];
  if (!listener || !cleanup) throw new Error('Expected an active stream');
  cleanup();
  cleanup();
  listener('late score');
  expect(response.write).toHaveBeenCalledTimes(1);
});

test('unsubscribes if writing response headers fails during setup', () => {
  vi.spyOn(response, 'writeHead').mockImplementationOnce(() => {
    throw new Error('header failure');
  });
  expect(() => streamScores(holder, 'M1', response, 15000)).toThrow('header failure');
  holder.putScore('M1', '15-0');
  expect(response.write).not.toHaveBeenCalled();
});

test('releases response listeners if subscription setup throws', () => {
  vi.spyOn(holder, 'subscribe').mockImplementationOnce(() => {
    throw new Error('subscribe failed');
  });
  expect(() => streamScores(holder, 'M1', response, 15000)).toThrow('subscribe failed');
  expect(response.headersSent).toBe(false);
});
