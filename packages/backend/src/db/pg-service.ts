import { Pool, PoolClient } from 'pg';

type QueryablePool = Pick<Pool, 'query' | 'end' | 'connect'>;

export type QueryClient = Pick<PoolClient, 'query' | 'release'>;

const DEFAULT_CONNECTION_STRING = process.env.DATABASE_URL || "postgres://postgres:password@localhost:54322/postgres";

let activePool: QueryablePool | null = null;

const createDefaultPool = () => new Pool({ connectionString: DEFAULT_CONNECTION_STRING });

const getPool = () => {
  if (!activePool) {
    activePool = createDefaultPool();
  }
  return activePool;
};

export const query = (text: string, params: any[] = []) => {
  return getPool().query(text, params);
};

export const getQueryClient = async (): Promise<QueryClient> => {
  const client = await getPool().connect();
  return client;
};

export const setTestPool = (pool: QueryablePool | null) => {
  activePool = pool;
};

process.on('SIGINT', () => {
    if (activePool) {
        activePool.end().then(() => {
            console.log('PostgreSQL pool disconnected on app termination.');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});