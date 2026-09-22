import { expectTypeOf, test } from 'vitest';
import type { INotification, IScoreHolder, ISubscription } from '../src/interfaces/scoreHolder';
import type ScoreHolder from '../src/scoreHolder';
import type { ScoreListener } from '../src/types/scoreHolder';

// These contracts are enforced by npm run typecheck, which is part of npm run validate.
test('the public adapter contract exposes the same operations as the implementation', () => {
  expectTypeOf<Pick<ScoreHolder, keyof IScoreHolder>>().toEqualTypeOf<IScoreHolder>();
  expectTypeOf<(score: string) => Promise<void>>().not.toExtend<
    Parameters<IScoreHolder['subscribe']>[1]
  >();
});

test('stored subscription listeners preserve the synchronous callback contract', () => {
  expectTypeOf<ISubscription['listener']>().toEqualTypeOf<ScoreListener>();
  expectTypeOf<(score: string) => Promise<void>>().not.toExtend<ISubscription['listener']>();
});

test('queued recipient snapshots cannot be extended but registrations remain cancellable', () => {
  expectTypeOf<INotification['subscriptions']>().toEqualTypeOf<readonly ISubscription[]>();
  expectTypeOf<Pick<ISubscription, 'active'>>().toEqualTypeOf<{ active: boolean }>();
});
