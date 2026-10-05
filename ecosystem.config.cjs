// Run with Node.js 22 or newer. The application's worker runs inside this single process.
// Set EARN_NODE_BIN in the shell starting PM2 if its daemon uses an older Node version.
const common = {
  cwd: __dirname,
  interpreter: process.env.EARN_NODE_BIN || 'node',
  node_args: ['--env-file=.env'],
  exec_mode: 'fork',
  instances: 1,
  watch: false,
  autorestart: true,
  min_uptime: '30s',
  max_restarts: 10,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 30000,
  time: true,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'kadena-earn',
      script: 'scripts/pm2-server.js',
      out_file: 'logs/kadena-earn-out.log',
      error_file: 'logs/kadena-earn-error.log',
    },
    {
      ...common,
      name: 'kadena-earn-backup',
      script: 'scripts/backup-loop.js',
      out_file: 'logs/kadena-earn-backup-out.log',
      error_file: 'logs/kadena-earn-backup-error.log',
    },
  ],
};
