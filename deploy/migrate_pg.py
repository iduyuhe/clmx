"""Stage-3 PostgreSQL migration orchestrator.
Uploads postgres schema + fresh dist + worker src + importer, then:
 stop app -> backup db -> extract dist/src -> prisma generate (pg) -> db push ->
 set .env DATABASE_URL (pg) -> import data (tenantId backfill) -> restart -> verify.
"""
import os
import paramiko

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")
CLMX_PG_PW = "U7nRft0o1eMd4YuUNrI2g8fT"
DATABASE_URL = f"postgresql://clmx:{CLMX_PG_PW}@127.0.0.1:5432/clmx"

LOCAL_SCHEMA = r"G:/clmx/server/prisma/schema.prisma"
LOCAL_DIST = r"G:/clmx/deploy/dist.tar.gz"
LOCAL_SRC = r"G:/clmx/deploy/src.tar.gz"
LOCAL_IMPORT = r"G:/clmx/server/scripts/import_pg.cjs"

REMOTE_SCHEMA = "/opt/clmx/server/prisma/schema.prisma"
REMOTE_IMPORT = "/opt/clmx/server/scripts/import_pg.cjs"

# Build postgres schema content (swap provider only)
with open(LOCAL_SCHEMA, "r", encoding="utf-8") as f:
    schema_txt = f.read()
schema_txt = schema_txt.replace('provider = "sqlite"', 'provider = "postgresql"')
assert 'provider = "postgresql"' in schema_txt, "provider swap failed"
print("postgres schema prepared")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=20)

def run(cmd, timeout=300, label=""):
    print(f"\n----- {label or cmd[:60]} -----")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    print(out if out else "(no stdout)")
    if err:
        print("STDERR:", err)
    return out, err

# SFTP uploads
sftp = client.open_sftp()
client.exec_command("mkdir -p /opt/clmx/server/scripts")
with sftp.open(REMOTE_SCHEMA, "w") as f:
    f.write(schema_txt)
print("uploaded schema.prisma (postgres)")
sftp.put(LOCAL_IMPORT, REMOTE_IMPORT)
print("uploaded import_pg.cjs")
sftp.put(LOCAL_DIST, "/tmp/dist.tar.gz")
print("uploaded dist.tar.gz")
sftp.put(LOCAL_SRC, "/tmp/src.tar.gz")
print("uploaded src.tar.gz")
sftp.close()

# 1. stop app
run("pm2 stop clmx 2>&1 || true", label="pm2 stop clmx")
# 2. backup db
run("cp /opt/clmx/server/prisma/dev.db /opt/clmx/server/prisma/dev.db.bak.migrate.$(date +%Y%m%d%H%M%S) 2>&1; ls -la /opt/clmx/server/prisma/dev.db.bak.migrate.* | tail -1", label="backup dev.db")
# 3. extract dist + src
run("cd /opt/clmx/server && tar xzf /tmp/dist.tar.gz && tar xzf /tmp/src.tar.gz && echo extracted_ok", label="extract dist+src")
# 4. prisma generate (postgres)
run("cd /opt/clmx/server && npx prisma generate 2>&1 | tail -15", label="prisma generate (pg)")
# 5. set .env DATABASE_URL
run(f"sed -i 's|^DATABASE_URL=.*|DATABASE_URL={DATABASE_URL}|' /opt/clmx/server/.env && grep DATABASE_URL /opt/clmx/server/.env | sed 's/:[^@]*@/:***@/'", label="set .env DATABASE_URL")
# 6. db push
run("cd /opt/clmx/server && npx prisma db push --accept-data-loss --skip-generate 2>&1 | tail -25", label="prisma db push (pg)")
# 7. import data
run(f"cd /opt/clmx/server && DATABASE_URL='{DATABASE_URL}' node scripts/import_pg.cjs 2>&1 | tail -45", timeout=300, label="import data")
# 8. restart app
run("pm2 restart clmx 2>&1 || true", label="pm2 restart clmx")
# 9. verify
run("sleep 8; echo '== internal health =='; curl -s -o /dev/null -w 'health=%{http_code}\\n' http://127.0.0.1:3100/health; echo '== login =='; curl -s -o /dev/null -w 'login=%{http_code}\\n' -X POST http://127.0.0.1:3100/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"test@test.com\",\"password\":\"123456\"}'; echo '== extern 3003 =='; curl -s -o /dev/null -w 'frontend=%{http_code}\\n' http://127.0.0.1:3003/", label="verify")

client.close()
print("\n===== MIGRATION ORCHESTRATION DONE =====")
