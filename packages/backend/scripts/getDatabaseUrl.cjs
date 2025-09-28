const LOCAL_SUPABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.SUPABASE_POSTGRES_URL ||
    process.env.SUPABASE_CONNECTION_STRING ||
    LOCAL_SUPABASE_URL
  );
}

module.exports = {
  getDatabaseUrl,
  LOCAL_SUPABASE_URL,
};
