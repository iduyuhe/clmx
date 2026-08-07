/**
 * CLMX PM2 生态系统配置
 * 用途：生产环境进程管理、自动重启、日志轮转、健康监控
 * 用法：pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'clmx',
      script: 'dist/server.js',
      cwd: '/opt/clmx/server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
      },
      // 自动重启
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: 10000,
      // 内存监控：超过 1GB 自动重启
      max_memory_restart: '1G',
      // 日志
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/opt/clmx/logs/clmx-error.log',
      out_file: '/opt/clmx/logs/clmx-out.log',
      merge_logs: true,
      // 健康检查
      listen_timeout: 15000,
      kill_timeout: 10000,
      // 自动重启次数超限后停止尝试
      exp_backoff_restart_delay: 10000,
    },
    {
      name: 'clmx-mqtt',
      script: 'scripts/mqtt_ingest.cjs',
      cwd: '/opt/clmx/server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        MQTT_SELF_BROKER: '1',
      },
      max_restarts: 5,
      restart_delay: 5000,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/opt/clmx/logs/mqtt-error.log',
      out_file: '/opt/clmx/logs/mqtt-out.log',
      merge_logs: true,
    },
    {
      name: 'clmx-opcua',
      script: 'scripts/opcua_ingest.cjs',
      cwd: '/opt/clmx/server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 5,
      restart_delay: 5000,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/opt/clmx/logs/opcua-error.log',
      out_file: '/opt/clmx/logs/opcua-out.log',
      merge_logs: true,
    },
    {
      name: 'clmx-modbus',
      script: 'scripts/modbus_ingest.cjs',
      cwd: '/opt/clmx/server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 5,
      restart_delay: 5000,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/opt/clmx/logs/modbus-error.log',
      out_file: '/opt/clmx/logs/modbus-out.log',
      merge_logs: true,
    },
  ],
}
