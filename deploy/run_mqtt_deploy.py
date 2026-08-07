"""将 MQTT 摄入适配器经 pm2 常驻生产（自托管 aedes broker），并做发布验证。

前置：CLMX_SSH_PASS 已设置（环境变量）。
用法：
    python deploy/run_mqtt_deploy.py
"""
import os, sys
import paramiko

HOST = os.environ.get('CLMX_HOST', '43.153.172.52')
USER = os.environ.get('CLMX_USER', 'root')
PASS = os.environ.get('CLMX_SSH_PASS')
if not PASS:
    print('ERROR: CLMX_SSH_PASS 未设置（本会话无服务器密码，无法部署）。')
    print('       请在包含该环境变量的会话中运行，或提供密码后重试。')
    sys.exit(2)

LOCAL_INGEST = r'G:/clmx/server/scripts/mqtt_ingest.cjs'
LOCAL_PUBTEST = r'G:/clmx/server/scripts/mqtt_pubtest.cjs'
REMOTE_DIR = '/opt/clmx/server/scripts'
REMOTE_INGEST = f'{REMOTE_DIR}/mqtt_ingest.cjs'
REMOTE_PUBTEST = f'{REMOTE_DIR}/mqtt_pubtest.cjs'


def sh(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return out, err, stdout.channel.recv_exit_status()


client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=30)
print('[1] SSH 连接成功')

sftp = client.open_sftp()
sftp.put(LOCAL_INGEST, REMOTE_INGEST)
sftp.put(LOCAL_PUBTEST, REMOTE_PUBTEST)
sftp.close()
print('[2] 上传 mqtt_ingest.cjs + mqtt_pubtest.cjs')

print('[3] 确保 aedes + mqtt 已安装...')
out, err, code = sh(client, 'cd /opt/clmx/server && npm install aedes mqtt --no-audit --no-fund 2>&1 | tail -3')
print('   code', code, out.strip()[:150])

print('[4] pm2 启动/重启常驻进程 clmx-mqtt（自托管 broker）...')
cmd = (
    'cd /opt/clmx/server && '
    'set -a && source .env && set +a && '
    'export MQTT_SELF_BROKER=1 MQTT_BROKER_PORT=1883 MQTT_TOPIC="clmx/+/+/telemetry" && '
    'pm2 delete clmx-mqtt 2>/dev/null ; '
    'pm2 start scripts/mqtt_ingest.cjs --name clmx-mqtt && '
    'pm2 save'
)
out, err, code = sh(client, cmd)
print(out.strip()[:600])
if err.strip():
    print('   stderr:', err.strip()[:300])

# 等待进程起来
import time
time.sleep(3)

print('[5] 健康检查：pm2 状态')
out, err, code = sh(client, 'pm2 status clmx-mqtt --no-color 2>&1 | tail -8')
print(out.strip())

print('[6] 发布验证（对常驻 broker 推一条）...')
out, err, code = sh(client, 'cd /opt/clmx/server && node scripts/mqtt_pubtest.cjs 2>&1 | tail -6')
print('--- pubtest output ---')
print(out.strip())
print('   exit', code)

client.close()
if 'PASS' in out:
    print('MQTT 常驻部署 + 验证 PASS')
else:
    print('MQTT 部署完成但 pubtest 未 PASS，请检查日志：pm2 logs clmx-mqtt')
