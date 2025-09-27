cd packages/backend
# 自动生成 .env 文件
echo '# Supabase Local Database Connection' > .env
echo "DATABASE_URL=\"postgresql://postgres:postgres@127.0.0.1:54322/postgres\"" >> .env
echo '' >> .env
echo '# Supabase Local JWT Secret (used by authPlugin.ts)' >> .env
echo "SUPABASE_JWT_SECRET=\"super-secret-jwt-token-with-at-least-32-characters-long\"" >> .env
cat .env
cd ..
