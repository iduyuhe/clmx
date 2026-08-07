#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLMX 全量部署（幂等）：上传 server/dist + client/dist 到生产，重启 clmx。
前置：环境变量 CLMX_SSH_PASS。运行：
  set CLMX_SSH_PASS=<密码> && python deploy/run_full_deploy.py
"""
import os, sys, paramiko

HOST = '43.153.172.52'; PORT = 22; USER = 'root'
REMOTE_SERVER = '/opt/clmx/server'
REMOTE_CLIENT = '/opt/clmx/client'
LOCAL_SERVER_DIST = os.path.join(os.path.dirname(__file__), '..', 'server', 'dist')
LOCAL_CLIENT_DIST = os.path.join(os.path.dirname(__file__), '..', 'client', 'dist')

def ssh_cmd(ssh, cmd, timeout=120):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', 'replace'), stderr.read().decode('utf-8', 'replace')

def upload_tree(sftp, local_root, remote_root):
    count = 0
    for root, _dirs, files in os.walk(local_root):
        for f in files:
            local_path = os.path.join(root, f)
            rel = os.path.relpath(local_path, local_root).replace('\\', '/')
            remote_path = f'{remote_root}/{rel}'
            remote_dir = os.path.dirname(remote_path)
            try:
                sftp.stat(remote_dir)
            except IOError:
                sftp.mkdir(remote_dir)
            sftp.put(local_path, remote_path)
            count += 1
    return count

def main():
    pw = os.environ.get('CLMX_SSH_PASS')
    if not pw:
        print('ERROR: 请先设置环境变量 CLMX_SSH_PASS'); sys.exit(2)
    cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, port=PORT, username=USER, password=pw, timeout=20)
    sftp = cli.open_sftp()

    print('上传 server/dist ...')
    n1 = upload_tree(sftp, LOCAL_SERVER_DIST, f'{REMOTE_SERVER}/dist')
    print(f'  {n1} 文件')
    print('上传 client/dist ...')
    n2 = upload_tree(sftp, LOCAL_CLIENT_DIST, f'{REMOTE_CLIENT}/dist')
    print(f'  {n2} 文件')
    # 同步 Python 训练 Worker（部署不传 node_modules，但 worker 脚本需更新）
    worker_src = os.path.join(os.path.dirname(__file__), '..', 'server', 'src', 'worker', 'train_worker.py')
    sftp.put(worker_src, f'{REMOTE_SERVER}/src/worker/train_worker.py')
    print('  train_worker.py')
    # 同步 schema.prisma（生产用 postgresql，需从本地 sqlite 版本转换）
    import shutil, tempfile
    schema_src = os.path.join(os.path.dirname(__file__), '..', 'server', 'prisma', 'schema.prisma')
    schema_pg = schema_src + '.pg'
    with open(schema_src) as f:
        content = f.read().replace('provider = "sqlite"', 'provider = "postgresql"')
    with open(schema_pg, 'w') as f:
        f.write(content)
    sftp.put(schema_pg, f'{REMOTE_SERVER}/prisma/schema.prisma')
    os.unlink(schema_pg)
    print('  schema.prisma (postgresql)')
    sftp.close()

    # 再生 Prisma Client
    out, _ = ssh_cmd(cli, 'cd /opt/clmx/server && npx prisma generate', timeout=60)
    print('PRISMA GENERATE:', out.strip()[:100])

    # 上传 ecosystem 配置并设置日志轮转
    eco_src = os.path.join(os.path.dirname(__file__), '..', 'server', 'ecosystem.config.cjs')
    sftp = cli.open_sftp()
    sftp.put(eco_src, f'{REMOTE_SERVER}/ecosystem.config.cjs')
    sftp.close()
    print('  ecosystem.config.cjs')
    # 安装 pm2-logrotate
    out, _ = ssh_cmd(cli, 'pm2 install pm2-logrotate 2>&1 | tail -2', timeout=30)
    print('PM2 LOGROTATE:', out.strip()[:100])
    # 用 ecosystem 重启（确保所有 app 按新配置启动）
    out, _ = ssh_cmd(cli, 'pm2 startOrRestart /opt/clmx/server/ecosystem.config.cjs --only clmx', timeout=60)
    print('PM2 START:', out.strip()[:100])

    # 健康检查
    import time; time.sleep(3)
    out, err = ssh_cmd(cli, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/health", timeout=30)
    print('HEALTH (3100):', out.strip())
    out, _ = ssh_cmd(cli, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/", timeout=30)
    print('WEB (3003):', out.strip())

    cli.close()
    print('RESULT: 全量部署完成')

if __name__ == '__main__':
    main()
