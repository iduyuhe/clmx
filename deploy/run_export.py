"""Upload + run export_sqlite.py on server. Read-only on source DB."""
import os
import paramiko

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")

LOCAL_EXPORT = r"G:/clmx/server/scripts/export_sqlite.py"
REMOTE_EXPORT = "/opt/clmx/server/scripts/export_sqlite.py"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=20)

sftp = client.open_sftp()
os.makedirs("/tmp", exist_ok=True)
client.exec_command("mkdir -p /opt/clmx/server/scripts")
sftp.put(LOCAL_EXPORT, REMOTE_EXPORT)
sftp.close()

stdin, stdout, stderr = client.exec_command("cd /opt/clmx/server && python3 scripts/export_sqlite.py 2>&1", timeout=60)
out = stdout.read().decode("utf-8", "replace").strip()
err = stderr.read().decode("utf-8", "replace").strip()
print("STDOUT:\n", out)
print("STDERR:\n", err)

client.close()
