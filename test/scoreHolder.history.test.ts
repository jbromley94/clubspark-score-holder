import { describe, expect, test } from 'vitest';
import ScoreHolder from '../src/scoreHolder';

describe('score history', () => {
  test('returns an empty history for an unknown match', () => {
    const scoreHolder = new ScoreHolder();

    expect(scoreHolder.getHistory('unknown-match')).toEqual([]);
  });

  test('returns scores from oldest to newest', () => {
    const scoreHolder = new ScoreHolder(3);

    scoreHolder.putScore('M1', '0-0');
    scoreHolder.putScore('M1', '15-0');

    expect(scoreHolder.getHistory('M1')).toEqual(['0-0', '15-0']);
  });

  test('keeps only the last N scores', () => {
    const scoreHolder = new ScoreHolder(2);

    scoreHolder.putScore('M1', '0-0');
    scoreHolder.putScore('M1', '15-0');
    scoreHolder.putScore('M1', '30-0');
    scoreHolder.putScore('M1', '40-0');

    expect(scoreHolder.getHistory('M1')).toEqual(['30-0', '40-0']);
    expect(scoreHolder.getScore('M1')).toBe('40-0');
  });

  test('keeps history limits independent for each match', () => {
    const scoreHolder = new ScoreHolder(2);

    scoreHolder.putScore('M1', '0-0');
    scoreHolder.putScore('M2', '0-15');
    scoreHolder.putScore('M1', '15-0');
    scoreHolder.putScore('M1', '30-0');

    expect(scoreHolder.getHistory('M1')).toEqual(['15-0', '30-0']);
    expect(scoreHolder.getHistory('M2')).toEqual(['0-15']);
  });

  test('protects stored history from changes to a returned array', () => {
    const scoreHolder = new ScoreHolder();

    scoreHolder.putScore('M1', '0-0');
    const history = scoreHolder.getHistory('M1');
    history.push('tampered');

    expect(scoreHolder.getHistory('M1')).toEqual(['0-0']);
    expect(scoreHolder.getScore('M1')).toBe('0-0');
  });

  test('defaults to keeping ten scores', () => {
    const scoreHolder = new ScoreHolder();

    for (let score = 0; score < 11; score++) {
      scoreHolder.putScore('M1', String(score));
    }

    expect(scoreHolder.getHistory('M1')).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
  });

  test.each([1, 2, 3, 10])(
    'preserves history and latest score through repeated wraps (limit %s)',
    (limit) => {
      const scoreHolder = new ScoreHolder(limit);
      const published: string[] = [];

      for (let index = 0; index < limit * 5; index++) {
        const score = index % 2 === 0 ? '' : String(index);
        published.push(score);
        scoreHolder.putScore('M1', score);

        expect(scoreHolder.getHistory('M1')).toEqual(published.slice(-limit));
        expect(scoreHolder.getScore('M1')).toBe(score);
      }
    },
  );

  test('allocates history as scores arrive even with a large limit', () => {
    const scoreHolder = new ScoreHolder(Number.MAX_SAFE_INTEGER);
    scoreHolder.putScore('M1', '15-0');

    expect(scoreHolder.getHistory('M1')).toEqual(['15-0']);
    expect(scoreHolder.getScore('M1')).toBe('15-0');
  });

  test('returns independent snapshots after the history wraps', () => {
    const scoreHolder = new ScoreHolder(2);
    for (const score of ['0-0', '15-0', '30-0']) {
      scoreHolder.putScore('M1', score);
    }

    const snapshot = scoreHolder.getHistory('M1');
    scoreHolder.putScore('M1', '40-0');
    expect(snapshot).toEqual(['15-0', '30-0']);

    snapshot[0] = 'tampered';
    expect(scoreHolder.getHistory('M1')).toEqual(['30-0', '40-0']);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid history limit: %s',
    (limit) => {
      expect(() => new ScoreHolder(limit)).toThrow(RangeError);
    },
  );
});
