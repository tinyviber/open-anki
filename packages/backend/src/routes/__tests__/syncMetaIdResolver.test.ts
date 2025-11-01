import { describe, expect, it } from 'bun:test';
import type { QueryClient } from '../../db/database.js';
import { __internal } from '../syncRoutes.js';

const { resolveSyncMetaIdType } = __internal;

const createStubClient = (
    handlers: Array<{
        matcher: (sql: string) => boolean;
        result: { rows: Array<Record<string, unknown>> };
    }>
): QueryClient => {
    const query = async (
        sql: unknown,
        _params?: readonly unknown[]
    ): Promise<{ rows: Array<Record<string, unknown>> }> => {
        if (typeof sql !== 'string') {
            throw new Error(`Unsupported query shape: ${String(sql)}`);
        }
        const handler = handlers.find(entry => entry.matcher(sql));
        if (!handler) {
            throw new Error(`Unexpected query: ${sql}`);
        }
        return handler.result;
    };

    return {
        query: query as QueryClient['query'],
        release: () => undefined,
    };
};

const uuidValue = 'c2323725-514a-4340-951d-9cce492641c5';

describe('resolveSyncMetaIdType', () => {
    it('derives UUID type when introspection reports bigint but sample data contains UUIDs', async () => {
        const client = createStubClient([
            {
                matcher: sql => sql.includes('FROM pg_attribute'),
                result: { rows: [{ data_type: 'int8' }] },
            },
            {
                matcher: sql => sql.includes('information_schema.columns'),
                result: { rows: [{ data_type: 'bigint' }] },
            },
            {
                matcher: sql => sql.includes('pg_typeof'),
                result: { rows: [{ data_type: 'bigint' }] },
            },
            {
                matcher: sql => sql.includes('SELECT id') && sql.includes('sync_meta') && !sql.includes('pg_typeof'),
                result: { rows: [{ id: uuidValue }] },
            },
        ]);

        const detected = await resolveSyncMetaIdType(client, 'user-1');
        expect(detected).toBe('uuid');
    });

    it('returns bigint when both introspection and samples are numeric', async () => {
        const client = createStubClient([
            {
                matcher: sql => sql.includes('FROM pg_attribute'),
                result: { rows: [{ data_type: 'int8' }] },
            },
            {
                matcher: sql => sql.includes('information_schema.columns'),
                result: { rows: [{ data_type: 'bigint' }] },
            },
            {
                matcher: sql => sql.includes('pg_typeof'),
                result: { rows: [{ data_type: 'bigint' }] },
            },
            {
                matcher: sql => sql.includes('SELECT id') && sql.includes('sync_meta') && !sql.includes('pg_typeof'),
                result: { rows: [{ id: '42' }] },
            },
        ]);

        const detected = await resolveSyncMetaIdType(client, 'user-2');
        expect(detected).toBe('bigint');
    });
});
