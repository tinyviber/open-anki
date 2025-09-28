import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { setTestPool } from '../db/pg-service.js';

let buildApp: typeof import('../index.js')['buildApp'];

describe('buildApp auth preHandler', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    ({ buildApp } = await import('../index.js'));
    setTestPool({
      connect: async () => {
        throw new Error('Database should not be accessed for unauthorized requests');
      },
      query: async () => {
        throw new Error('Database should not be accessed for unauthorized requests');
      },
      end: async () => {}
    } as any);
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (typeof address === 'object' && address) {
      baseUrl = `http://${address.address}:${address.port}`;
    } else if (typeof address === 'string') {
      baseUrl = address;
    } else {
      throw new Error('Failed to determine Fastify server address for tests');
    }
  });

  afterAll(async () => {
    setTestPool(null);
    await app.close();
  });

  it('returns 401 for unauthenticated push requests', async () => {
    const response = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'test-device',
        ops: [],
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      statusCode: 401,
      message: 'Missing or invalid Authorization header',
    });
  });
});
