"""Run the server-side stage-2 timeseries e2e (e2e_online.cjs) against the live PG instance."""
import os
import paramiko

HOST = os.environ.get("CLMX_HOST", "43.153.172.52")
USER = os.environ.get("CLMX_USER", "root")
PASS = os.environ.get("CLMX_SSH_PASS", "")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=20)

cmd = "cd /opt/clmx/server && node e2e_online.cjs 2>&1"
print(f"RUN: {cmd}")
stdin, stdout, stderr = client.exec_command(cmd, timeout=240)
out = stdout.read().decode("utf-8", "replace").strip()
err = stderr.read().decode("utf-8", "replace").strip()
print(out)
if err:
    print("STDERR:", err)
client.close()
print("===== E2E ONLINE DONE =====")
