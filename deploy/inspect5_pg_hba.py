"""Locate and read pg_hba.conf + pg data dir (read-only, no su)."""
import os
import paramiko

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")

cmds = [
    ("PG_HBA_LOC", "find /etc /var/lib /usr -name 'pg_hba.conf' 2>/dev/null; echo '---'; ls -ld /var/lib/pgsql 2>/dev/null; ls -ld /var/lib/postgresql 2>/dev/null"),
    ("PG_HBA_CONTENT", "for f in $(find /etc /var/lib /usr -name 'pg_hba.conf' 2>/dev/null); do echo \"## $f\"; cat \"$f\" 2>/dev/null | grep -vE '^\\s*#|^\\s*$'; done"),
    ("PG_CONF_LISTEN", "for f in $(find /etc /var/lib /usr -name 'postgresql.conf' 2>/dev/null); do echo \"## $f\"; grep -E '^(listen_addresses|port|max_connections|shared_buffers|work_mem)' \"$f\" 2>/dev/null; done"),
    ("PG_DATA_DIRS", "ls -la /var/lib/pgsql/*/data 2>/dev/null; ls -la /var/lib/postgresql/*/main 2>/dev/null"),
    ("TRY_PSQL_ROOT", "psql -U postgres -h 127.0.0.1 -tAc 'SELECT 1' 2>&1 | head -3"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=20)
for label, c in cmds:
    print(f"\n===== {label} =====")
    stdin, stdout, stderr = client.exec_command(c, timeout=25)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    print(out if out else (err if err else "(empty)"))
client.close()
print("\n===== DONE =====")
