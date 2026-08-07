"""Inspect PostgreSQL internals + seed/admin bootstrap to plan migration. Read-only."""
import os
import paramiko

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")

cmds = [
    ("PG_DBS", "su - postgres -c \"psql -tAc '\\l'\" 2>/dev/null || psql -U postgres -tAc '\\l' 2>/dev/null || echo 'peer_failed'"),
    ("PG_ROLES", "su - postgres -c \"psql -tAc '\\du'\" 2>/dev/null || echo 'peer_failed'"),
    ("PG_VERSION", "su - postgres -c \"psql -tAc 'SELECT version()'\" 2>/dev/null | head -1"),
    ("PG_HBA", "cat /var/lib/pgsql/data/pg_hba.conf 2>/dev/null | grep -v '^#' | grep -v '^$' | head -20; ls /var/lib/pgsql 2>/dev/null; find /etc /var/lib -name 'pg_hba.conf' 2>/dev/null"),
    ("PG_PWFILE", "su - postgres -c \"psql -tAc \\\"SELECT rolname, CASE WHEN rolpassword IS NULL THEN 'no_pw' ELSE 'has_pw' END FROM pg_roles WHERE rolname IN ('postgres','clmx')\\\"\" 2>/dev/null"),
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
print("\n===== DONE =====")
