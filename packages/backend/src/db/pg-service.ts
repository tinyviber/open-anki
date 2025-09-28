import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, PoolClient } from 'pg';

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const parentDir = resolve(moduleDir, '..');
const packageRoot = basename(parentDir) === 'src' ? resolve(parentDir, '..') : parentDir;
const { getDatabaseUrl } = require(resolve(packageRoot, 'scripts/getDatabaseUrl.cjs')) as {
  getDatabaseUrl: () => string;
};

type QueryablePool = Pick<Pool, 'query' | 'end' | 'connect'>;

export type QueryClient = Pick<PoolClient, 'query' | 'release'>;

const DEFAULT_CONNECTION_STRING = getDatabaseUrl();

let activePool: QueryablePool | null = null;

const createDefaultPool = () => new Pool({ connectionString: DEFAULT_CONNECTION_STRING });

const getPool = () => {
  if (!activePool) {
    activePool = createDefaultPool();
  }
  return activePool;
};

export const query = (text: string, params: readonly unknown[] = []) => {
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