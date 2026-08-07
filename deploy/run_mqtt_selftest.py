"""部署 MQTT 适配器并运行 --selftest（直连 PG，不依赖 broker）。"""
import os, sys, time
import paramiko

HOST = os.environ.get('CLMX_HOST', '43.153.172.52')
USER = os.environ.get('CLMX_USER', 'root')
PASS = os.environ.get('CLMX_SSH_PASS')
if not PASS:
    print('ERROR: CLMX_SSH_PASS not set'); sys.exit(2)

LOCAL = r'G:/clmx/server/scripts/mqtt_ingest.cjs'
REMOTE = '/opt/clmx/server/scripts/mqtt_ingest.cjs'

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
sftp.put(LOCAL, REMOTE)
sftp.close()
print('[2] 上传 mqtt_ingest.cjs')

# 尽力安装 mqtt（无外网则跳过，selftest 不依赖）
print('[3] 尝试 npm install mqtt（best-effort）...')
out, err, code = sh(client, 'cd /opt/clmx/server && npm install mqtt --no-audit --no-fund 2>&1 | tail -5')
print('   npm install mqtt code', code, '| out:', out.strip()[:200])

# 运行 selftest
print('[4] 运行 --selftest ...')
out, err, code = sh(client, 'cd /opt/clmx/server && node scripts/mqtt_ingest.cjs --selftest 2>&1 | tail -15')
print('--- selftest output ---')
print(out.strip())
print('   exit', code)
client.close()
print('DONE' if 'PASS' in out else 'SELFTEST FAILED')
