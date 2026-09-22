import { expectTypeOf, test } from 'vitest';
import type ScoreHolder from '../src/scoreHolder';
import type { ScoreListener, Unsubscribe } from '../src/types/scoreHolder';

test('requires a listener that returns undefined rather than a promise', () => {
  expectTypeOf<Parameters<ScoreHolder['subscribe']>[1]>().toEqualTypeOf<ScoreListener>();
  expectTypeOf<ScoreListener>().returns.toEqualTypeOf<undefined>();
  expectTypeOf<(score: string) => Promise<void>>().not.toExtend<ScoreListener>();
});

test('exposes cancellation and subscription return types', () => {
  expectTypeOf<ReturnType<ScoreHolder['subscribe']>>().toEqualTypeOf<Unsubscribe>();
  expectTypeOf<ScoreHolder['waitForNextScore']>().toEqualTypeOf<
    (match: string, signal?: AbortSignal) => Promise<string>
  >();
});
