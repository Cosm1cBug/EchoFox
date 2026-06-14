module.exports = {
  apps: [
    {
      name: 'echofox',
      script: 'src/core/bootstrap.js',
      node_args: '--enable-source-maps --max-old-space-size=1024',
      instances: 1, // bootstrap already supervises a fork
      autorestart: true,
      max_memory_restart: '900M',
      kill_timeout: 12000,
      listen_timeout: 8000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        PORT: 3000,
      },
    },
  ],
};
