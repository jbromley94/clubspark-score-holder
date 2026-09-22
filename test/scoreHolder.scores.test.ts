import { describe, expect, test } from 'vitest';
import ScoreHolder from '../src/scoreHolder';

describe('storing and retrieving scores', () => {
  test('returns the score stored for a match', () => {
    const scoreHolder = new ScoreHolder();

    scoreHolder.putScore('M1', 'SET 1 GAME 1 0-0');

    expect(scoreHolder.getScore('M1')).toBe('SET 1 GAME 1 0-0');
  });

  test('returns the latest score after an update', () => {
    const scoreHolder = new ScoreHolder();

    scoreHolder.putScore('M1', 'SET 1 GAME 1 0-0');
    scoreHolder.putScore('M1', 'SET 1 GAME 1 15-0');

    expect(scoreHolder.getScore('M1')).toBe('SET 1 GAME 1 15-0');
  });

  test('keeps scores for different matches independent', () => {
    const scoreHolder = new ScoreHolder();

    scoreHolder.putScore('M1', 'SET 1 GAME 1 0-0');
    scoreHolder.putScore('M2', 'SET 2 GAME 3 0-30');
    scoreHolder.putScore('M1', 'SET 1 GAME 1 15-0');

    expect(scoreHolder.getScore('M1')).toBe('SET 1 GAME 1 15-0');
    expect(scoreHolder.getScore('M2')).toBe('SET 2 GAME 3 0-30');
  });

  test('returns undefined when no score exists for a match', () => {
    const scoreHolder = new ScoreHolder();

    expect(scoreHolder.getScore('unknown-match')).toBeUndefined();
  });
});
