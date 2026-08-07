#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""聚焦勘察 clmx 进程：配置 / 崩溃原因 / 现有 nginx / schema 列。只读。"""
import paramiko, os, sys

if sys.platform == 'win32':
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except: pass

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASSWORD = os.environ.get("CLMX_SSH_PASS", "")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
print("CONNECT OK")

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

run("echo '=== clmx.conf ==='; cat /etc/nginx/conf.d/clmx.conf 2>/dev/null || echo 'no clmx.conf'")
run("echo '=== pm2 describe clmx ==='; pm2 describe clmx 2>/dev/null | head -40")
run("echo '=== ecosystem/config ==='; ls /opt/clmx/server/ecosystem.config.* 2>/dev/null; cat /opt/clmx/server/ecosystem.config.js 2>/dev/null | head -40")
run("echo '=== .env ==='; cat /opt/clmx/server/.env 2>/dev/null || echo 'no .env'")
run("echo '=== schema domain column? ==='; grep -n 'domain\\|dataType' /opt/clmx/server/prisma/schema.prisma 2>/dev/null || echo 'no match (old schema)'")
run("echo '=== dist present? ==='; ls /opt/clmx/server/dist/server.js 2>/dev/null && echo 'HAS dist' || echo 'NO dist'")
run("echo '=== clmx logs ==='; pm2 logs clmx --lines 30 --nostream 2>/dev/null")
c.close()
print("\nINSPECT2 DONE")
