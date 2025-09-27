module.exports = {
  apps: [
    {
      name: 'open-anki-frontend',
      script: 'bun',
      args: 'run dev --host 0.0.0.0',
      cwd: './packages/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      }
    },
    // OpenAnki 后端服务配置
    {
      name: 'open-anki-backend',
      script: 'bun',
      args: 'run start', 
      cwd: './packages/backend',
      instances: 1,
      autorestart: true,
      watch: ['packages/backend/src'], // 仅监控后端代码变动
      ignore_watch: ["node_modules", "dist", "*.log"],
      env_file: './packages/backend/.env', // PM2 从这里加载数据库和 JWT 密钥
    }
  ]
};
