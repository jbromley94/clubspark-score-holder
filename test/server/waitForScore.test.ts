import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ScoreHolder from '../../src/scoreHolder';
import waitForScore from '../../src/server/waitForScore';
import { createResponse } from '../helpers/httpResponse';

let holder: ScoreHolder;
let response: ReturnType<typeof createResponse>['response'];
beforeEach(() => {
  vi.useFakeTimers();
  holder = new ScoreHolder();
  response = createResponse().response;
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
  expect(response.listenerCount('error')).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('removes the timer and abort listener after successful completion', async () => {
  const spy = vi.spyOn(holder, 'waitForNextScore');
  const end = vi.spyOn(response, 'end');
  const pending = waitForScore(holder, 'M1', response, 30000);
  const signal = spy.mock.calls[0]?.[1];
  if (!signal) throw new Error('Expected a cancellation signal');
  expect(getEventListeners(signal, 'abort')).toHaveLength(1);
  holder.putScore('M1', '15-0');
  await pending;
  expect(end).toHaveBeenCalledWith('{"match":"M1","score":"15-0"}');
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  expect(signal.aborted).toBe(false);
});

test('does not expire early and removes its core waiter when the deadline expires', async () => {
  const spy = vi.spyOn(holder, 'waitForNextScore');
  const end = vi.spyOn(response, 'end');
  const pending = waitForScore(holder, 'M1', response, 30000);
  const signal = spy.mock.calls[0]?.[1];
  if (!signal) throw new Error('Expected a cancellation signal');
  await vi.advanceTimersByTimeAsync(29999);
  expect(end).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(response.statusCode).toBe(204);
  expect(end).toHaveBeenCalledExactlyOnceWith();
  expect(signal.aborted).toBe(true);
  expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  holder.putScore('M1', 'too late');
  expect(end).toHaveBeenCalledTimes(1);
});

test.each(['close', 'error'])('cancels and releases its wait on response %s', async (event) => {
  const spy = vi.spyOn(holder, 'waitForNextScore');
  const end = vi.spyOn(response, 'end');
  const pending = waitForScore(holder, 'M1', response, 30000);
  response.emit(event);
  await pending;
  const signal = spy.mock.calls[0]?.[1];
  expect(signal?.aborted).toBe(true);
  expect(end).not.toHaveBeenCalled();
});

test('does not write after a client disconnects between resolution and response delivery', async () => {
  const end = vi.spyOn(response, 'end');
  const pending = waitForScore(holder, 'M1', response, 30000);
  holder.putScore('M1', '15-0');
  response.destroy();
  await pending;
  expect(end).not.toHaveBeenCalled();
});

test('releases its resources when the holder unexpectedly rejects', async () => {
  const failure = new Error('storage unavailable');
  vi.spyOn(holder, 'waitForNextScore').mockRejectedValueOnce(failure);
  await expect(waitForScore(holder, 'M1', response, 30000)).rejects.toBe(failure);
});
