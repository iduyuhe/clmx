"""部署 MQTT 适配器并运行 --brokertest（内嵌 aedes 真实发布/订阅往返）。"""
import os, sys
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

print('[3] 安装 aedes + mqtt（best-effort）...')
out, err, code = sh(client, 'cd /opt/clmx/server && npm install aedes mqtt --no-audit --no-fund 2>&1 | tail -3')
print('   code', code, out.strip()[:150])

print('[4] 运行 --brokertest ...')
out, err, code = sh(client, 'cd /opt/clmx/server && node scripts/mqtt_ingest.cjs --brokertest 2>&1 | tail -15')
print('--- brokertest output ---')
print(out.strip())
print('   exit', code)
client.close()
print('DONE' if 'PASS' in out else 'BROKERTEST FAILED')
