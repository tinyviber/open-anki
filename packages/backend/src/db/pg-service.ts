import { Pool, QueryResult } from 'pg';

type QueryParams = any[];
type QueryImplementation = (text: string, params?: QueryParams) => Promise<QueryResult<any>>;

// 使用 Supabase 提供的连接字符串，确保权限正确（非 service_role key）
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:password@localhost:54322/postgres",
});

let currentQuery: QueryImplementation = (text: string, params: QueryParams = []) =>
  pool.query(text, params);

export const query = (text: string, params: QueryParams = []) => {
  return currentQuery(text, params);
};

export const setQueryClient = (client: { query: QueryImplementation }) => {
  currentQuery = (text: string, params: QueryParams = []) => client.query(text, params);
};

export const resetQueryClient = () => {
  currentQuery = (text: string, params: QueryParams = []) => pool.query(text, params);
};

process.on('SIGINT', () => {
    pool.end(() => {
        console.log('PostgreSQL pool disconnected on app termination.');
        process.exit(0);
    });
});