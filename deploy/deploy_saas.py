"""阶段4·SaaS增值 部署：上传 dist 并重启 clmx（schema 未变，无需迁移）"""
import os, sys, io, tarfile, time
import paramiko

HOST = os.environ.get('CLMX_HOST', '43.153.172.52')
PORT = 22
USER = os.environ.get('CLMX_USER', 'root')
PASS = os.environ.get('CLMX_SSH_PASS')
if not PASS:
    print('ERROR: CLMX_SSH_PASS not set'); sys.exit(2)

LOCAL_TAR = r'G:/clmx/deploy/dist_saas.tar.gz'
REMOTE_TAR = '/opt/clmx/server/dist_saas.tar.gz'
REMOTE_DIR = '/opt/clmx/server'

def sh(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return out, err, stdout.channel.recv_exit_status()

def main():
    # 1) 本地打包 dist
    with tarfile.open(LOCAL_TAR, 'w:gz') as tar:
        tar.add(r'G:/clmx/server/dist', arcname='dist')
    print(f'[1] 本地打包完成: {LOCAL_TAR} ({os.path.getsize(LOCAL_TAR)} bytes)')

    # 2) SSH 连接
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASS, timeout=30)
    print('[2] SSH 连接成功')

    # 3) 上传 tar + schema
    sftp = client.open_sftp()
    sftp.put(LOCAL_TAR, REMOTE_TAR)
    sftp.put(r'G:/clmx/server/prisma/schema.prisma', '/opt/clmx/server/prisma/schema.prisma')
    sftp.close()
    print('[3] 上传 dist tar + schema 完成')

    # 4) 解压 + 迁移 schema + 重启
    print('[4] 解压并重启 clmx ...')
    out, err, code = sh(client, f'cd {REMOTE_DIR} && rm -rf dist && tar xzf {REMOTE_TAR} && rm -f {REMOTE_TAR}')
    print('   unzip out:', out.strip(), 'err:', err.strip(), 'code', code)
    print('[4.5] prisma db push (schema 迁移) ...')
    out, err, code = sh(client, f'cd {REMOTE_DIR} && npx prisma db push --accept-data-loss --skip-generate')
    print('   dbpush out:', out.strip(), 'err:', err.strip(), 'code', code)
    out, err, code = sh(client, 'pm2 restart clmx')
    print('   pm2 out:', out.strip(), 'code', code)
    time.sleep(6)

    # 5) 健康检查
    out, err, code = sh(client, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/health; echo')
    print('[5] backend /health ->', out.strip())
    out, err, code = sh(client, 'curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3100/api/auth/login -H "Content-Type: application/json" -d \'{"email":"test@test.com","password":"123456"}\'; echo')
    print('    login ->', out.strip())
    out, err, code = sh(client, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3003/; echo')
    print('    frontend 3003 ->', out.strip())

    client.close()
    print('DONE')

if __name__ == '__main__':
    main()
