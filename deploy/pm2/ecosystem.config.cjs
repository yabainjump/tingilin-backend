const instances = Number(process.env.PM2_INSTANCES || 3);
const basePort = Number(process.env.APP_PORT || 3001);

module.exports = {
  apps: [
    {
      name: 'tingilin-api',
      script: 'dist/main.js',
      cwd: process.env.APP_CWD || process.cwd(),
      exec_mode: 'fork',
      instances,
      instance_var: 'INSTANCE_ID',
      increment_var: 'APP_PORT',
      min_uptime: '30s',
      listen_timeout: 10000,
      kill_timeout: 8000,
      wait_ready: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY || '512M',
      merge_logs: true,
      out_file: process.env.PM2_OUT_FILE || 'logs/pm2-out.log',
      error_file: process.env.PM2_ERR_FILE || 'logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      exp_backoff_restart_delay: 200,
      env: {
        NODE_ENV: 'production',
        APP_PORT: String(basePort),
        TRUST_PROXY: process.env.TRUST_PROXY || '1',
        HTTP_KEEP_ALIVE_TIMEOUT_MS:
          process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || '65000',
        HTTP_HEADERS_TIMEOUT_MS:
          process.env.HTTP_HEADERS_TIMEOUT_MS || '66000',
        HTTP_REQUEST_TIMEOUT_MS:
          process.env.HTTP_REQUEST_TIMEOUT_MS || '120000',
      },
    },
  ],
};
