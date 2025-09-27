import { Pool } from 'pg';

// 使用 Supabase 提供的连接字符串，确保权限正确（非 service_role key）
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:password@localhost:54322/postgres", 
});

export const query = (text: string, params: any[] = []) => {
  return pool.query(text, params);
};

process.on('SIGINT', () => {
    pool.end(() => {
        console.log('PostgreSQL pool disconnected on app termination.');
        process.exit(0);
    });
});