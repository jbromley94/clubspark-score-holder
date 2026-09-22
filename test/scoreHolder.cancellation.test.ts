import { getEventListeners } from 'node:events';
import { describe, expect, test } from 'vitest';
import ScoreHolder from '../src/scoreHolder';

describe('cancelling a wait for the next score', () => {
  test('rejects immediately when the signal is already aborted', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    controller.abort();

    await expect(scoreHolder.waitForNextScore('M1', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('cancels a wait with the supplied reason even if a score then arrives', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    const reason = new Error('Request disconnected');
    const cancelled = scoreHolder.waitForNextScore('M1', controller.signal);
    const rejection = expect(cancelled).rejects.toBe(reason);

    controller.abort(reason);
    scoreHolder.putScore('M1', '15-0');

    await rejection;
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);

    const nextScore = scoreHolder.waitForNextScore('M1');
    scoreHolder.putScore('M1', '30-0');
    await expect(nextScore).resolves.toBe('30-0');
  });

  test('cancels one waiter without affecting another for the same match', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    const reason = new Error('Request disconnected');
    const cancelled = scoreHolder.waitForNextScore('M1', controller.signal);
    const remaining = scoreHolder.waitForNextScore('M1');
    const rejection = expect(cancelled).rejects.toBe(reason);

    controller.abort(reason);
    scoreHolder.putScore('M1', '15-0');

    await rejection;
    await expect(remaining).resolves.toBe('15-0');
  });

  test('honours cancellation when an earlier abort handler publishes a score', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    const reason = new Error('Request disconnected');

    // Register first to reproduce a score arriving during abort-event dispatch.
    controller.signal.addEventListener('abort', () => scoreHolder.putScore('M1', '15-0'), {
      once: true,
    });
    const cancelled = scoreHolder.waitForNextScore('M1', controller.signal);
    const remaining = scoreHolder.waitForNextScore('M1');
    const rejection = expect(cancelled).rejects.toBe(reason);

    controller.abort(reason);

    await rejection;
    await expect(remaining).resolves.toBe('15-0');
    expect(scoreHolder.getScore('M1')).toBe('15-0');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('removes its abort listener after receiving a score', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    const nextScore = scoreHolder.waitForNextScore('M1', controller.signal);

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
    scoreHolder.putScore('M1', '15-0');

    await expect(nextScore).resolves.toBe('15-0');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('an abort after resolution does not affect a later waiter', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    const first = scoreHolder.waitForNextScore('M1', controller.signal);
    scoreHolder.putScore('M1', '15-0');

    const second = scoreHolder.waitForNextScore('M1');
    controller.abort();
    scoreHolder.putScore('M1', '30-0');

    await expect(first).resolves.toBe('15-0');
    await expect(second).resolves.toBe('30-0');
  });

  test('cancels all waits sharing one request signal across different matches', async () => {
    const scoreHolder = new ScoreHolder();
    const controller = new AbortController();
    const reason = new Error('Request disconnected');
    const first = scoreHolder.waitForNextScore('M1', controller.signal);
    const second = scoreHolder.waitForNextScore('M2', controller.signal);
    const firstRejection = expect(first).rejects.toBe(reason);
    const secondRejection = expect(second).rejects.toBe(reason);

    controller.abort(reason);

    await firstRejection;
    await secondRejection;
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});
