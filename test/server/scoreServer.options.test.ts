import { afterEach, expect, expectTypeOf, test, vi } from 'vitest';
import type { IScoreHolder } from '../../src/interfaces/scoreHolder';
import type { IScoreServerOptions } from '../../src/interfaces/scoreServer';
import ScoreHolder from '../../src/scoreHolder';
import { createScoreServer } from '../../src/server/scoreServer';
import { createResponse } from '../helpers/httpResponse';

afterEach(() => vi.restoreAllMocks());

test('accepts the public holder contract and optional server timing configuration', () => {
  expectTypeOf(createScoreServer).parameters.toEqualTypeOf<
    [scoreHolder: IScoreHolder, options?: IScoreServerOptions | undefined]
  >();
  expectTypeOf<IScoreServerOptions>().toEqualTypeOf<{
    readonly waitTimeoutMs?: number;
    readonly heartbeatIntervalMs?: number;
  }>();
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648])(
  'rejects unsupported timer values: %s',
  (interval) => {
    expect(() => createScoreServer(new ScoreHolder(), { waitTimeoutMs: interval })).toThrow(
      RangeError,
    );
    expect(() => createScoreServer(new ScoreHolder(), { heartbeatIntervalMs: interval })).toThrow(
      RangeError,
    );
  },
);

test.each([1, 2147483647])('accepts timer boundary values: %s', (interval) => {
  const server = createScoreServer(new ScoreHolder(), {
    waitTimeoutMs: interval,
    heartbeatIntervalMs: interval,
  });
  expect(server.listening).toBe(false);
});

test('closes a partially started response instead of sending a second set of headers', async () => {
  const server = createScoreServer(new ScoreHolder());
  const { request, response } = createResponse();
  request.url = '/matches/M1/events';
  const end = vi.spyOn(response, 'end');
  vi.spyOn(response, 'writeHead').mockImplementationOnce(() => {
    // Simulate failure after headers have reached the output stream.
    response.flushHeaders();
    throw new Error('transport failed after headers');
  });
  server.emit('request', request, response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(response.destroyed).toBe(true);
  expect(end).not.toHaveBeenCalled();
});
