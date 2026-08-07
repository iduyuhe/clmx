#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""只读勘察：连上生产服务器，打印环境状态，不做任何修改。"""
import paramiko, os, sys

if sys.platform == 'win32':
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except: pass

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PORT = int(os.environ.get("CLMX_PORT", "22"))
PASSWORD = os.environ.get("CLMX_SSH_PASS", "")
APP_PORT = os.environ.get("CLMX_APP_PORT", "3003")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)
except Exception as e:
    print("CONNECT FAIL:", type(e).__name__, str(e)[:200])
    sys.exit(1)
print("CONNECT OK ->", USER, "@", HOST)

def run(cmd):
    i, o, e = c.exec_command(cmd)
    out = o.read().decode('utf-8', 'replace')
    err = e.read().decode('utf-8', 'replace')
    rc = o.channel.recv_exit_status()
    print(f"\n### {cmd}  (rc={rc})")
    if out.strip():
        for l in out.rstrip().split('\n'):
            print("   ", l)
    if err.strip() and rc != 0:
        for l in err.rstrip().split('\n'):
            print("   [ERR]", l)

run("uname -a")
run("cat /etc/os-release 2>/dev/null | head -3")
run("echo node=$(node -v 2>/dev/null); echo npm=$(npm -v 2>/dev/null); echo pm2=$(pm2 -v 2>/dev/null); echo py=$(python3 --version 2>/dev/null)")
run("ls -la /opt/clmx 2>/dev/null || echo 'NO /opt/clmx'")
run("ls /opt/clmx/server/prisma/dev.db 2>/dev/null && echo 'HAS DB' || echo 'NO DB'")
run("ls /opt/clmx/client/dist/index.html 2>/dev/null && echo 'HAS CLIENT DIST' || echo 'NO CLIENT DIST'")
run("ss -ltnp 2>/dev/null | grep -E ':(3002|3003|3004|443)' || netstat -ltnp 2>/dev/null | grep -E ':(3002|3003|3004|443)' || echo 'no listener match'")
run("pm2 ls 2>/dev/null || echo 'no pm2'")
run("ls /etc/nginx/conf.d/ 2>/dev/null; echo '--- confs ---'; cat /etc/nginx/conf.d/*.conf 2>/dev/null | head -60")
c.close()
print("\nINSPECT DONE")
