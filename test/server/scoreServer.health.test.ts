import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startScoreServer } from '../helpers/scoreServer';

describe('HTTP score adapter health check', () => {
  let testServer: Awaited<ReturnType<typeof startScoreServer>>;

  beforeEach(async () => {
    testServer = await startScoreServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('reports that the server is healthy', async () => {
    const response = await fetch(`${testServer.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('rejects unsupported methods for the health check', async () => {
    const response = await fetch(`${testServer.baseUrl}/health`, {
      method: 'POST',
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });
});
