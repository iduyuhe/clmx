#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLMX · OPC-UA 摄入适配器常驻部署（幂等）
- SFTP 上传 server/scripts/opcua_ingest.cjs + 默认映射模板 opcua_map.example.json
- 服务器安装 node-opcua（若缺失）
- pm2 启动 clmx-opcua（仅增加进程，不影响 clmx / clmx-mqtt）
- 健康检查 + --selftest 摄入验证

前置：环境变量 CLMX_SSH_PASS（服务器 root 密码）。运行：
  set CLMX_SSH_PASS=<密码> && python deploy/run_opcua_deploy.py
"""
import os, sys, paramiko, io

HOST = '43.153.172.52'
PORT = 22
USER = 'root'
REMOTE_DIR = '/opt/clmx/server'
SCRIPT = 'opcua_ingest.cjs'
MAP_EXAMPLE = 'opcua_map.example.json'

LOCAL_SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'server', 'scripts', SCRIPT)
LOCAL_MAP = os.path.join(os.path.dirname(__file__), '..', 'server', 'scripts', MAP_EXAMPLE)

def ssh_cmd(ssh, cmd, timeout=120):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return out, err

def main():
    pw = os.environ.get('CLMX_SSH_PASS')
    if not pw:
        print('ERROR: 请先设置环境变量 CLMX_SSH_PASS'); sys.exit(2)

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, port=PORT, username=USER, password=pw, timeout=20)

    # 1) 上传脚本
    sftp = cli.open_sftp()
    for local, remote in [(LOCAL_SCRIPT, f'{REMOTE_DIR}/scripts/{SCRIPT}'),
                          (LOCAL_MAP, f'{REMOTE_DIR}/scripts/{MAP_EXAMPLE}')]:
        if os.path.exists(local):
            sftp.put(local, remote); print('uploaded', remote)
        else:
            print('WARN 本地缺失', local)
    sftp.close()

    # 2) 安装 node-opcua（如缺失）
    out, _ = ssh_cmd(cli, f'cd {REMOTE_DIR} && node -e "require.resolve(\'node-opcua\')" 2>/dev/null && echo HAVE || echo NEED')
    if 'NEED' in out:
        print('installing node-opcua ...')
        ssh_cmd(cli, f'cd {REMOTE_DIR} && npm install node-opcua --no-audit --no-fund', timeout=600)

    # 3) 确保默认映射文件存在
    ssh_cmd(cli, f'cd {REMOTE_DIR} && [ -f opcua_map.json ] || cp scripts/{MAP_EXAMPLE} opcua_map.json')

    # 4) pm2 启动（幂等：先删后起）
    ssh_cmd(cli, 'pm2 delete clmx-opcua 2>/dev/null || true')
    # 不自动连接外部服务器（需用户配置 OPCUA_ENDPOINT + 映射）；这里以 --selftest 验证摄入链路可达
    start_cmd = (
        f'cd {REMOTE_DIR} && pm2 start scripts/{SCRIPT} --name clmx-opcua '
        f'-- --selftest'
    )
    out, err = ssh_cmd(cli, start_cmd, timeout=120)
    print('START:', out.strip(), err.strip())

    # 5) 健康检查
    out, _ = ssh_cmd(cli, 'sleep 2 && pm2 status clmx-opcua --json 2>/dev/null | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{try{const a=JSON.parse(d);console.log(a[0]?.pm2_env?.status||\'unknown\')}catch(e){console.log(\'unknown\')}})"', timeout=30)
    print('PM2 STATUS:', out.strip())

    # 6) selftest 摄入验证（直连 PG）
    out, err = ssh_cmd(cli, f'cd {REMOTE_DIR} && node scripts/{SCRIPT} --selftest', timeout=60)
    print('SELFTEST:', out.strip(), err.strip())

    cli.close()
    ok = ('[selftest] PASS' in out)
    print('RESULT:', 'OPC-UA 部署 + 验证 PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
