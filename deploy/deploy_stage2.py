#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""CLMX 阶段2 部署到新端口 3003（增量更新现有 /opt/clmx）。

前提（只读勘察已确认）：
- /opt/clmx 存在，dev.db / client/dist 都在 -> 增量更新，保留数据
- 端口 3003 空闲；clmx PM2 因 3002 被 A-GEO 占用而 EADDRINUSE 崩溃
- 密码从环境变量 CLMX_SSH_PASS 读取，不写死在脚本里

步骤：上传 dist/src/schema -> 备份并迁移 DB(阶段2 新列) -> prisma generate
      -> .env PORT=3003 -> clmx.conf 监听3003+proxy3003 -> nginx reload -> pm2 restart -> 验证
"""
import paramiko, os, sys, time
from pathlib import Path

if sys.platform == 'win32':
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except: pass

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASSWORD = os.environ.get("CLMX_SSH_PASS", "")
PORT = 22
APP_PORT = os.environ.get("CLMX_APP_PORT", "3003")

PROJECT_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_DIR / "server"
REMOTE_SERVER = "/opt/clmx/server"


class D:
    def __init__(self):
        self.c = paramiko.SSHClient()
        self.c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.sftp = None

    def connect(self):
        print(f"[Connect] {USER}@{HOST}:{PORT} ...")
        self.c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
        self.sftp = self.c.open_sftp()
        print("[Connect] OK")

    def exec(self, cmd, desc=""):
        if desc: print(f"[Exec] {desc}")
        print(f"  $ {cmd}")
        i, o, e = self.c.exec_command(cmd)
        out = o.read().decode('utf-8', 'replace')
        err = e.read().decode('utf-8', 'replace')
        rc = o.channel.recv_exit_status()
        for l in out.rstrip().split('\n'):
            if l.strip(): print(f"    {l}")
        if err and rc != 0:
            for l in err.rstrip().split('\n'):
                if l.strip(): print(f"    [ERR] {l}")
        return rc, out, err

    def put_dir(self, local, remote):
        local = Path(local)
        print(f"  UPLOAD DIR {local} -> {remote}")
        try:
            self.exec(f"mkdir -p {remote}")
            for root, dirs, files in os.walk(local):
                rel = Path(root).relative_to(local)
                rsub = f"{remote}/{rel.as_posix()}" if str(rel) != '.' else remote
                if str(rel) != '.':
                    self.exec(f"mkdir -p {rsub}")
                for f in files:
                    lf = Path(root) / f
                    self.sftp.put(str(lf), f"{rsub}/{f}")
            return True
        except Exception as ex:
            print(f"  UPLOAD FAILED: {ex}")
            return False


def main():
    d = D()
    d.connect()

    print("=== 1. 上传新代码 (dist / src / schema) ===")
    d.put_dir(SERVER_DIR / "dist", f"{REMOTE_SERVER}/dist")
    d.put_dir(SERVER_DIR / "src", f"{REMOTE_SERVER}/src")
    d.sftp.put(str(SERVER_DIR / "prisma/schema.prisma"), f"{REMOTE_SERVER}/prisma/schema.prisma")
    print("  上传完成")

    print("=== 2. 备份并迁移 DB（阶段2 新列，保留数据）===")
    ts = time.strftime("%Y%m%d%H%M%S")
    d.exec(f"cp {REMOTE_SERVER}/prisma/dev.db {REMOTE_SERVER}/prisma/dev.db.bak.{ts}", "备份 DB")
    d.sftp.put(str(PROJECT_DIR / "deploy/migrate_stage2.py"), "/tmp/migrate_stage2.py")
    d.exec("python3 /tmp/migrate_stage2.py", "执行迁移")

    print("=== 3. 重新生成 Prisma client（匹配新 schema）===")
    d.exec(f"cd {REMOTE_SERVER} && npx prisma generate", "prisma generate")

    print(f"=== 4. 改 .env PORT -> {APP_PORT} ===")
    d.exec(f"sed -i 's/^PORT=.*/PORT={APP_PORT}/' {REMOTE_SERVER}/.env", "改 .env PORT")
    d.exec(f"grep '^PORT=' {REMOTE_SERVER}/.env", "确认 PORT")

    print(f"=== 5. 改 nginx clmx.conf 监听 {APP_PORT} ===")
    d.exec(f"sed -i 's/listen 443;/listen {APP_PORT};/' /etc/nginx/conf.d/clmx.conf", "clmx.conf listen")
    d.exec(f"sed -i 's#proxy_pass http://127.0.0.1:3002;#proxy_pass http://127.0.0.1:{APP_PORT};#' /etc/nginx/conf.d/clmx.conf", "clmx.conf proxy")
    rc, _, _ = d.exec("nginx -t", "nginx 配置检查")
    if rc == 0:
        d.exec("nginx -s reload", "nginx reload")
    else:
        print("  [WARN] nginx -t 失败，跳过 reload，请手动检查 clmx.conf")

    print("=== 6. 重启 clmx (端口已改 3003) ===")
    d.exec("pm2 restart clmx --update-env", "pm2 restart")
    time.sleep(6)

    print(f"=== 7. 验证 (端口 {APP_PORT}) ===")
    d.exec(f"curl -s http://localhost:{APP_PORT}/api/health", "health(local)")
    d.exec(f"curl -s -o /dev/null -w 'Frontend HTTP: %{{http_code}}\\n' http://localhost:{APP_PORT}/", "frontend(local)")
    d.exec(f"curl -s -o /dev/null -w 'External HTTP: %{{http_code}}\\n' http://43.153.172.52:{APP_PORT}/api/health", "health(external)")
    d.exec("pm2 describe clmx | grep -E 'status|restart|uptime'", "clmx 进程状态")

    d.c.close()
    print("=== 部署脚本执行完毕 ===")


if __name__ == "__main__":
    main()
