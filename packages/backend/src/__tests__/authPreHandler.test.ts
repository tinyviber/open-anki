import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { setTestPool } from '../db/database.js';

let buildApp: typeof import('../index.js')['buildApp'];

describe('buildApp auth preHandler', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const ORIGINAL_SECRET = process.env.SUPABASE_JWT_SECRET;
  const TEST_SECRET = 'test-secret';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
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
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = ORIGINAL_SECRET;
    }
  });

  it('returns 401 for unauthenticated push requests', async () => {
    const response = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'test-device',
        ops: [
          {
            entityId: 'deck-1',
            entityType: 'deck',
            version: Date.now(),
            op: 'delete',
            timestamp: Date.now(),
          },
        ],
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
