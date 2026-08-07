"""Read-only inspection for Stage-3 PostgreSQL migration feasibility.
Connects via paramiko, gathers environment facts, prints them. No writes/mutations.
"""
import os
import paramiko

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")

cmds = [
    ("OS", "cat /etc/os-release 2>/dev/null | head -4"),
    ("KERNEL", "uname -r"),
    ("MEM", "free -h"),
    ("MEM_MB", "free -m | awk '/Mem:/{print \"total_mb=\"$2\" avail_mb=\"$7}'"),
    ("DISK", "df -h / /opt 2>/dev/null"),
    ("NPROC", "nproc"),
    ("UPTIME", "uptime"),
    ("PS_TOP_MEM", "ps -eo pid,comm,rss,pmem --sort=-rss 2>/dev/null | head -12"),
    ("PG_INSTALLED", "which psql pg_ctl initdb postgres 2>/dev/null; ls /usr/lib/postgresql 2>/dev/null; pg_lsclusters 2>/dev/null; echo '---systemd---'; systemctl is-active postgresql 2>/dev/null || echo no_systemd_pg"),
    ("DOCKER_PG", "docker ps 2>/dev/null | grep -i postgres || echo no_docker_pg"),
    ("CLMX_DIR", "ls -la /opt/clmx 2>/dev/null; du -sh /opt/clmx/server/prisma/dev.db 2>/dev/null; ls /opt/clmx/server/prisma/ 2>/dev/null"),
    ("CLMX_ENV", "grep -E 'DATABASE_URL|PORT|JWT' /opt/clmx/server/.env 2>/dev/null | sed -E 's/(JWT_SECRET=).*/\\1***/; s/(DATABASE_URL=).*/\\1***masked***/'"),
    ("PORTS", "ss -ltnp 2>/dev/null | head -40 || netstat -ltnp 2>/dev/null | head -40"),
    ("NODE_PM2_PY", "node -v 2>/dev/null; pm2 -v 2>/dev/null; python3 --version 2>/dev/null; which pip3 2>/dev/null"),
    ("PG_PORT", "ss -ltn 2>/dev/null | grep 5432 || echo '5432 free'"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=20)

for label, c in cmds:
    print(f"\n===== {label} =====")
    stdin, stdout, stderr = client.exec_command(c, timeout=30)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    print(out if out else (err if err else "(empty)"))

client.close()
print("\n===== INSPECTION DONE =====")
