import { describe, expect, test } from 'vitest';
import ScoreHolder from '../src/scoreHolder';

describe('waiting for the next score', () => {
  test('resolves with the next score published for the match', async () => {
    const scoreHolder = new ScoreHolder();
    const nextScore = scoreHolder.waitForNextScore('M1');

    scoreHolder.putScore('M1', '15-0');

    await expect(nextScore).resolves.toBe('15-0');
  });

  test('waits for an update even when a score already exists', async () => {
    const scoreHolder = new ScoreHolder();
    scoreHolder.putScore('M1', '0-0');

    const nextScore = scoreHolder.waitForNextScore('M1');
    scoreHolder.putScore('M1', '15-0');

    await expect(nextScore).resolves.toBe('15-0');
  });

  test('ignores updates for other matches', async () => {
    const scoreHolder = new ScoreHolder();
    const nextScore = scoreHolder.waitForNextScore('M1');

    scoreHolder.putScore('M2', '0-30');
    scoreHolder.putScore('M1', '15-0');

    await expect(nextScore).resolves.toBe('15-0');
  });

  test('resolves all consumers waiting for the same match', async () => {
    const scoreHolder = new ScoreHolder();
    const firstConsumer = scoreHolder.waitForNextScore('M1');
    const secondConsumer = scoreHolder.waitForNextScore('M1');

    scoreHolder.putScore('M1', '15-0');

    await expect(firstConsumer).resolves.toBe('15-0');
    await expect(secondConsumer).resolves.toBe('15-0');
  });

  test('captures the first rapid update and allows waiting again', async () => {
    const scoreHolder = new ScoreHolder();
    const firstWait = scoreHolder.waitForNextScore('M1');

    scoreHolder.putScore('M1', '15-0');
    scoreHolder.putScore('M1', '30-0');

    await expect(firstWait).resolves.toBe('15-0');

    const secondWait = scoreHolder.waitForNextScore('M1');
    scoreHolder.putScore('M1', '40-0');

    await expect(secondWait).resolves.toBe('40-0');
  });

  test('a wait created during a callback receives the next reentrant write', async () => {
    const scoreHolder = new ScoreHolder();
    const firstWait = scoreHolder.waitForNextScore('M1');
    let nextWait: Promise<string> | undefined;

    scoreHolder.subscribe('M1', (score) => {
      if (score === '0-0') {
        nextWait = scoreHolder.waitForNextScore('M1');
        scoreHolder.putScore('M1', '15-0');
      }
    });

    scoreHolder.putScore('M1', '0-0');
    await expect(firstWait).resolves.toBe('0-0');
    await expect(nextWait).resolves.toBe('15-0');
  });

  test('treats repeated score values as updates for all consumers', async () => {
    const scoreHolder = new ScoreHolder();
    const received: string[] = [];
    scoreHolder.putScore('M1', '0-0');
    const nextWait = scoreHolder.waitForNextScore('M1');
    scoreHolder.subscribe('M1', (score) => {
      received.push(score);
    });

    scoreHolder.putScore('M1', '0-0');

    await expect(nextWait).resolves.toBe('0-0');
    expect(received).toEqual(['0-0']);
    expect(scoreHolder.getHistory('M1')).toEqual(['0-0', '0-0']);
  });
});
