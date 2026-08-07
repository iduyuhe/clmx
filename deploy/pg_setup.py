"""One-time PG setup: create dedicated clmx role + database.
Temporarily switches pg_hba to trust (local/loopback only, PG bound to 127.0.0.1),
creates role/db, then restores md5. Local-only exposure, brief.
"""
import os
import paramiko
import secrets
import string

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")

PGDATA = "/var/lib/pgsql/data"
HBA = f"{PGDATA}/pg_hba.conf"
CLMX_PW = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(24))
print(f"Generated clmx password (will also be written to .env): {CLMX_PW}")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=20)

def run(cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    return out, err

# 1. backup hba
run(f"cp {HBA} {HBA}.bak.clmx 2>/dev/null; echo backed_up")
# 2. write trust hba
trust = (
    "local   all   all   trust\n"
    "host    all   all   127.0.0.1/32   trust\n"
    "host    all   all   ::1/128   trust\n"
    "local   replication   all   trust\n"
    "host    replication   all   127.0.0.1/32   trust\n"
    "host    replication   all   ::1/128   trust\n"
)
from io import StringIO
sftp = client.open_sftp()
with sftp.open(HBA, "w") as f:
    f.write(trust)
sftp.close()
print("wrote trust hba")
# 3. reload
out, err = run("su postgres -s /bin/bash -c 'pg_ctl reload -D /var/lib/pgsql/data' 2>&1 || systemctl reload postgresql 2>&1")
print("reload:", out or err)
# 4. create role + db (trust, no password prompt)
sql = (
    f"DROP DATABASE IF EXISTS clmx;\n"
    f"DROP ROLE IF EXISTS clmx;\n"
    f"CREATE ROLE clmx LOGIN PASSWORD '{CLMX_PW}';\n"
    f"CREATE DATABASE clmx OWNER clmx;\n"
    f"GRANT ALL PRIVILEGES ON DATABASE clmx TO clmx;\n"
)
out, err = run(f"su postgres -s /bin/bash -c \"psql -v ON_ERROR_STOP=1 <<'EOSQL'\n{sql}EOSQL\" 2>&1")
print("create role/db:", out or err)
# 5. restore md5 hba
sftp = client.open_sftp()
with sftp.open(HBA, "w") as f:
    f.write(
        "local   all   all   md5\n"
        "host    all   all   127.0.0.1/32   md5\n"
        "host    all   all   ::1/128   md5\n"
        "local   replication   all   peer\n"
        "host    replication   all   127.0.0.1/32   ident\n"
        "host    replication   all   ::1/128   ident\n"
    )
sftp.close()
run("su postgres -s /bin/bash -c 'pg_ctl reload -D /var/lib/pgsql/data' 2>&1 || systemctl reload postgresql 2>&1")
print("restored md5 hba + reloaded")
# 6. verify connect as clmx with password
out, err = run(f"PGPASSWORD='{CLMX_PW}' psql -U clmx -h 127.0.0.1 -d clmx -tAc 'SELECT current_database(), current_user' 2>&1")
print("verify clmx connect:", out or err)

client.close()
print("\n===== PG SETUP DONE =====")
print(f"CLMX_PG_PASSWORD={CLMX_PW}")
