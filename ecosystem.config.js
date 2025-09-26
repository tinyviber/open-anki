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
    }
  ]
};