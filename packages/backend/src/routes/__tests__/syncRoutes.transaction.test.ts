import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { syncRoutes } from '../syncRoutes.js';
import { setTestPool } from '../../db/database.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

type SyncMetaRow = {
  user_id: string;
  entity_id: string;
  entity_type: string;
  version: number;
  op: string;
  timestamp: Date;
  payload: any;
  device_id: string;
  diff: any;
};

type DeckRow = {
  id: string;
  user_id: string;
  name: any;
  description: any;
  config: any;
};

type Store = {
  syncMeta: SyncMetaRow[];
  decks: DeckRow[];
};

class RecordingClient {
  private inTransaction = false;
  private workingStore: Store;
  private snapshot: Store | null = null;

  constructor(private readonly rootStore: Store) {
    this.workingStore = rootStore;
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, ' ').replace(/;$/, '').trim();
    const upper = normalized.toUpperCase();

    if (upper === 'BEGIN') {
      this.inTransaction = true;
      this.snapshot = cloneStore(this.rootStore);
      this.workingStore = cloneStore(this.rootStore);
      return { rows: [], rowCount: null };
    }

    if (upper === 'COMMIT') {
      this.rootStore.syncMeta = this.workingStore.syncMeta.map(cloneSyncMetaRow);
      this.rootStore.decks = this.workingStore.decks.map(row => ({ ...row }));
      this.inTransaction = false;
      this.workingStore = this.rootStore;
      this.snapshot = null;
      return { rows: [], rowCount: null };
    }

    if (upper === 'ROLLBACK') {
      this.workingStore = this.snapshot ? cloneStore(this.snapshot) : this.rootStore;
      this.inTransaction = false;
      this.snapshot = null;
      return { rows: [], rowCount: null };
    }

    const lower = normalized.toLowerCase();
    const targetStore = this.inTransaction ? this.workingStore : this.rootStore;

    if (lower.startsWith('delete from sync_meta')) {
      targetStore.syncMeta = [];
      return { rows: [], rowCount: 0 };
    }

    if (lower.startsWith('delete from decks')) {
      if (lower.includes('where id = $1')) {
        const [id, userId] = params;
        targetStore.decks = targetStore.decks.filter(row => !(row.id === id && row.user_id === userId));
      } else {
        targetStore.decks = [];
      }
      return { rows: [], rowCount: 0 };
    }

    if (lower.startsWith('delete from notes')) {
      return { rows: [], rowCount: 0 };
    }

    if (lower.startsWith('insert into sync_meta')) {
      const row: SyncMetaRow = {
        user_id: params[0],
        entity_id: params[1],
        entity_type: params[2],
        version: params[3],
        op: params[4],
        timestamp: params[5] instanceof Date ? params[5] : new Date(params[5]),
        payload: params[6] ?? null,
        device_id: params[7],
        diff: params[8] ?? null,
      };

      if (!targetStore.syncMeta.some(existing => existing.entity_id === row.entity_id && existing.version === row.version)) {
        targetStore.syncMeta.push(row);
      }

      return { rows: [], rowCount: 1 };
    }

    if (lower.startsWith('insert into decks')) {
      const [id, userId, name, description, config] = params;
      if (!targetStore.decks.some(row => row.id === id)) {
        targetStore.decks.push({ id, user_id: userId, name, description, config });
      }
      return { rows: [], rowCount: 1 };
    }

    if (lower.startsWith('update decks')) {
      const [name, description, config, id, userId] = params;
      const deck = targetStore.decks.find(row => row.id === id && row.user_id === userId);
      if (deck) {
        deck.name = name;
        deck.description = description;
        deck.config = config;
      }
      return { rows: [], rowCount: deck ? 1 : 0 };
    }

    if (lower.startsWith('insert into notes')) {
      throw new Error('check constraint "notes_deck_id_check" is violated by some row');
    }

    if (lower.startsWith('select * from sync_meta')) {
      const rows = (this.inTransaction ? this.workingStore.syncMeta : this.rootStore.syncMeta).map(cloneSyncMetaRow);
      return { rows, rowCount: rows.length };
    }

    if (lower.startsWith('select version, device_id from sync_meta')) {
      const [userIdParam, entityIdParam] = params;
      const searchStore = this.inTransaction ? this.workingStore : this.rootStore;
      const matches = searchStore.syncMeta
        .filter(row => row.user_id === userIdParam && row.entity_id === entityIdParam)
        .sort((a, b) => b.version - a.version);
      if (matches.length === 0) {
        return { rows: [], rowCount: 0 };
      }
      const [{ version, device_id }] = matches;
      return { rows: [{ version, device_id }], rowCount: 1 };
    }

    if (lower.startsWith('select * from decks')) {
      const rows = (this.inTransaction ? this.workingStore.decks : this.rootStore.decks).map(row => ({ ...row }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unsupported query: ${text}`);
  }

  release() {
    // no-op for the recording client
  }
}

class RecordingPool {
  private store: Store = { syncMeta: [], decks: [] };

  async query(text: string, params: any[] = []) {
    const client = new RecordingClient(this.store);
    const result = await client.query(text, params);
    client.release();
    return result;
  }

  async connect() {
    return new RecordingClient(this.store);
  }

  async end() {}

  reset() {
    this.store.syncMeta = [];
    this.store.decks = [];
  }
}

function cloneStore(source: Store): Store {
  return {
    syncMeta: source.syncMeta.map(cloneSyncMetaRow),
    decks: source.decks.map(row => ({ ...row })),
  };
}

function cloneSyncMetaRow(row: SyncMetaRow): SyncMetaRow {
  return { ...row, timestamp: new Date(row.timestamp) };
}

describe('syncRoutes transaction rollback', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let pool: RecordingPool;

  beforeAll(async () => {
    pool = new RecordingPool();
    setTestPool(pool as any);

    app = Fastify({ logger: false });
    app.decorateRequest('user', null);
    app.addHook('preHandler', (request: any, _reply, done) => {
      request.user = { id: TEST_USER_ID };
      done();
    });
    await app.register(syncRoutes);
    await app.ready();
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

  beforeEach(() => {
    pool.reset();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('rolls back the entire transaction when an operation fails', async () => {
    const pushResponse = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device-1',
        ops: [
          {
            entityId: 'deck-rollback',
            entityType: 'deck',
            version: 1,
            op: 'create',
            timestamp: Date.now(),
            payload: {
              name: 'My Deck',
              description: 'Should not persist',
              config: {},
            },
          },
          {
            entityId: 'note-rollback',
            entityType: 'note',
            version: 2,
            op: 'create',
            timestamp: Date.now(),
            payload: {
              deck_id: 'invalid-deck',
              model_name: 'basic',
              fields: { front: 'Q', back: 'A' },
              tags: [],
            },
          },
        ],
      }),
    });

    expect(pushResponse.status).toBe(500);

    const syncMetaRows = await pool.query('SELECT * FROM sync_meta');
    expect(syncMetaRows.rows).toHaveLength(0);

    const deckRows = await pool.query('SELECT * FROM decks');
    expect(deckRows.rows).toHaveLength(0);
  });
});
