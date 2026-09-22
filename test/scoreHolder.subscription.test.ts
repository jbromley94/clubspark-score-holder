import { describe, expect, test } from 'vitest';
import ScoreHolder from '../src/scoreHolder';
import type { ScoreListener } from '../src/types/scoreHolder';

describe('score subscriptions', () => {
  test('receives future updates in order without replaying the current score', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.putScore('M1', '0-0');

    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    expect(received).toEqual([]);

    scoreHolder.putScore('M1', '15-0');
    scoreHolder.putScore('M1', '30-0');

    expect(received).toEqual(['15-0', '30-0']);
  });

  test('only receives updates for the subscribed match', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    scoreHolder.putScore('M2', '0-15');
    scoreHolder.putScore('M1', '15-0');

    expect(received).toEqual(['15-0']);
  });

  test('unsubscribes one consumer without affecting another', () => {
    const scoreHolder = new ScoreHolder();
    const first: string[] = [];
    const second: string[] = [];

    const unsubscribe = scoreHolder.subscribe('M1', (score) => {
      first.push(score);
    });

    scoreHolder.subscribe('M1', (score) => {
      second.push(score);
    });

    scoreHolder.putScore('M1', '15-0');
    unsubscribe();
    scoreHolder.putScore('M1', '30-0');

    expect(first).toEqual(['15-0']);
    expect(second).toEqual(['15-0', '30-0']);
  });

  test('repeated cancellation does not remove a new subscription', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    const unsubscribe = scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    unsubscribe();

    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    unsubscribe();
    scoreHolder.putScore('M1', '15-0');

    expect(received).toEqual(['15-0']);
  });

  test('keeps subscriptions independent when they share a callback', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];
    const onScore: ScoreListener = (score) => {
      received.push(score);
    };

    const unsubscribeFirst = scoreHolder.subscribe('M1', onScore);
    const unsubscribeSecond = scoreHolder.subscribe('M1', onScore);

    scoreHolder.putScore('M1', '15-0');
    expect(received).toEqual(['15-0', '15-0']);

    unsubscribeFirst();
    scoreHolder.putScore('M1', '30-0');
    expect(received).toEqual(['15-0', '15-0', '30-0']);

    unsubscribeSecond();
    scoreHolder.putScore('M1', '40-0');
    expect(received).toEqual(['15-0', '15-0', '30-0']);
  });

  test('skips a subscriber cancelled before its turn during delivery', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.subscribe('M1', () => {
      unsubscribeSecond();
    });

    const unsubscribeSecond = scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    scoreHolder.putScore('M1', '15-0');

    expect(received).toEqual([]);
  });

  test('notifies other consumers even when a subscriber throws', async () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];
    const nextScore = scoreHolder.waitForNextScore('M1');

    scoreHolder.subscribe('M1', () => {
      throw new Error('Subscriber failed');
    });

    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    expect(() => scoreHolder.putScore('M1', '15-0')).toThrow(AggregateError);

    expect(received).toEqual(['15-0']);
    expect(scoreHolder.getScore('M1')).toBe('15-0');
    expect(scoreHolder.getHistory('M1')).toEqual(['15-0']);
    await expect(nextScore).resolves.toBe('15-0');
  });

  test('preserves update order when a subscriber publishes another score', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.subscribe('M1', (score) => {
      if (score === '15-0') {
        scoreHolder.putScore('M1', '30-0');
      }
    });

    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    scoreHolder.putScore('M1', '15-0');

    expect(received).toEqual(['15-0', '30-0']);
  });

  test('continues queued delivery after errors and accepts later updates', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.subscribe('M1', (score) => {
      if (score === '15-0') {
        scoreHolder.putScore('M1', '30-0');
      }
    });

    const unsubscribeFailing = scoreHolder.subscribe('M1', () => {
      throw new Error('Subscriber failed');
    });

    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    expect(() => scoreHolder.putScore('M1', '15-0')).toThrow(AggregateError);
    expect(received).toEqual(['15-0', '30-0']);

    unsubscribeFailing();
    scoreHolder.putScore('M1', '40-0');

    expect(received).toEqual(['15-0', '30-0', '40-0']);
  });

  test('does not replay queued scores to subscriptions added during delivery', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.subscribe('M1', (score) => {
      if (score === '0-0') {
        scoreHolder.putScore('M1', '15-0');
        scoreHolder.subscribe('M1', (next) => {
          received.push(next);
        });
        scoreHolder.putScore('M1', '30-0');
      }
    });

    scoreHolder.putScore('M1', '0-0');
    expect(received).toEqual(['30-0']);
  });

  test('keeps cancelled queued subscriptions separate from a new registration', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];
    const listener: ScoreListener = (score) => {
      received.push(score);
    };

    scoreHolder.subscribe('M1', (score) => {
      if (score === '0-0') {
        scoreHolder.putScore('M1', '15-0');
        unsubscribe();
        scoreHolder.subscribe('M1', listener);
        scoreHolder.putScore('M1', '30-0');
      }
    });
    const unsubscribe = scoreHolder.subscribe('M1', listener);

    scoreHolder.putScore('M1', '0-0');
    expect(received).toEqual(['30-0']);
  });

  test('preserves FIFO delivery across matches and multiple nested writes', () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];

    scoreHolder.subscribe('M1', (score) => {
      if (score === '0-0') {
        scoreHolder.putScore('M2', '0-15');
        scoreHolder.putScore('M1', '15-0');
      }
    });
    scoreHolder.subscribe('M1', (score) => {
      received.push(`M1:${score}`);
    });
    scoreHolder.subscribe('M2', (score) => {
      received.push(`M2:${score}`);
      scoreHolder.putScore('M1', '30-0');
    });

    scoreHolder.putScore('M1', '0-0');
    expect(received).toEqual(['M1:0-0', 'M2:0-15', 'M1:15-0', 'M1:30-0']);
  });

  test('delivers long reentrant update chains without overflowing the stack', () => {
    const scoreHolder = new ScoreHolder(2);
    let received = 0;

    scoreHolder.subscribe('M1', (score) => {
      expect(Number(score)).toBe(received++);
      if (received < 10000) {
        scoreHolder.putScore('M1', String(received));
      }
    });

    scoreHolder.putScore('M1', '0');
    expect(received).toBe(10000);
    expect(scoreHolder.getHistory('M1')).toEqual(['9998', '9999']);
  });

  test('collects every thrown value in delivery order, including nested updates', () => {
    const scoreHolder = new ScoreHolder();
    const failure = new Error('Subscriber failed');

    const unsubscribe = scoreHolder.subscribe('M1', (score) => {
      if (score === '0-0') {
        scoreHolder.putScore('M1', '15-0');
        throw undefined;
      }
      throw failure;
    });

    let thrown: unknown;
    try {
      scoreHolder.putScore('M1', '0-0');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({
      errors: [undefined, failure],
      message: 'Scores stored, but subscriber notifications failed',
    });
    expect(scoreHolder.getScore('M1')).toBe('15-0');

    unsubscribe();
    scoreHolder.putScore('M1', '30-0');
    expect(scoreHolder.getScore('M1')).toBe('30-0');
  });
});
