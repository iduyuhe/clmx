#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修复端口冲突：后端用内部端口(3100)，nginx clmx.conf 用公开端口(3003) 反代到 3100。
原因：上一轮把后端和 nginx 都设成 3003 导致 EADDRINUSE。"""
import paramiko, os, sys, time

if sys.platform == 'win32':
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except: pass

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASSWORD = os.environ.get("CLMX_SSH_PASS", "")
PUB = os.environ.get("CLMX_PUB_PORT", "3003")      # 对外/安全组开放
INT = os.environ.get("CLMX_INT_PORT", "3100")      # 后端内部端口（仅 nginx 访问）
REMOTE = "/opt/clmx/server"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=20)

def run(cmd, desc=""):
    print(f"[Exec] {desc}\n  $ {cmd}")
    i, o, e = c.exec_command(cmd)
    out = o.read().decode('utf-8', 'replace')
    err = e.read().decode('utf-8', 'replace')
    rc = o.channel.recv_exit_status()
    for l in out.rstrip().split('\n'):
        if l.strip(): print("   ", l)
    if err and rc != 0:
        for l in err.rstrip().split('\n'):
            if l.strip(): print("   [ERR]", l)
    return rc

print(f"=== 检查内部端口 {INT} 是否空闲 ===")
rc, out, _ = c.exec_command(f"ss -ltn 2>/dev/null | grep -q ':{INT} ' && echo IN_USE || echo FREE")
print("   ", out.read().decode().strip())

print(f"=== .env 后端端口 -> {INT} ===")
run(f"sed -i 's/^PORT=.*/PORT={INT}/' {REMOTE}/.env", "改 .env PORT")
run(f"grep '^PORT=' {REMOTE}/.env", "确认 PORT")

print(f"=== clmx.conf: 公开 {PUB} -> 反代 {INT} ===")
run(f"sed -i 's/listen [0-9]\\+;/listen {PUB};/' /etc/nginx/conf.d/clmx.conf", "clmx.conf listen PUB")
run(f"sed -i 's#proxy_pass http://127.0.0.1:[0-9]\\+;#proxy_pass http://127.0.0.1:{INT};#' /etc/nginx/conf.d/clmx.conf", "clmx.conf proxy INT")
run("grep -nE 'listen|proxy_pass' /etc/nginx/conf.d/clmx.conf", "查看 clmx.conf 关键行")

print("=== nginx 检查并 reload ===")
rc = run("nginx -t", "nginx -t")
if rc == 0:
    run("nginx -s reload", "nginx reload")
else:
    print("  [WARN] nginx -t 失败，未 reload")

print("=== 重启 clmx ===")
run("pm2 restart clmx --update-env", "pm2 restart clmx")
time.sleep(6)

print(f"=== 验证 (公开 {PUB} / 内部 {INT}) ===")
run(f"curl -s http://localhost:{PUB}/api/health", "health via nginx(3003)")
run(f"curl -s -o /dev/null -w 'Frontend HTTP: %{{http_code}}\\n' http://localhost:{PUB}/", "frontend(3003)")
run(f"curl -s http://127.0.0.1:{INT}/api/health", "health direct backend(3100)")
run("pm2 describe clmx | grep -E 'status|uptime|restart'", "clmx 进程状态")

c.close()
print("FIX DONE")
