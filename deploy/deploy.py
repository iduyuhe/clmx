#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""CLMX Deployment Script — paramiko SSH + SCP"""

import paramiko
import os
import sys
import time
from pathlib import Path

# Fix Windows console encoding
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

HOST = "43.153.172.52"
USER = "root"
PASSWORD = "Duyuhe2004"
PORT = 22

PROJECT_DIR = Path(__file__).resolve().parent.parent
DEPLOY_DIR = Path(__file__).resolve().parent

REMOTE_TMP = "/tmp/clmx-deploy"
APP_DIR = "/opt/clmx"


class Deployer:
    def __init__(self):
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.sftp = None

    def connect(self):
        print(f"[Connect] {USER}@{HOST}:{PORT} ...")
        try:
            self.client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
            self.sftp = self.client.open_sftp()
            print("[Connect] OK - connected")
            return True
        except Exception as e:
            print(f"[Connect] FAILED: {e}")
            return False

    def exec_cmd(self, cmd, desc=""):
        if desc:
            print(f"[Exec] {desc}")
        print(f"  $ {cmd}")
        stdin, stdout, stderr = self.client.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        exit_code = stdout.channel.recv_exit_status()
        if out:
            for line in out.rstrip().split('\n'):
                print(f"    {line}")
        if err and exit_code != 0:
            for line in err.rstrip().split('\n'):
                print(f"    [ERR] {line}")
        return exit_code, out, err

    def put_file(self, local, remote):
        print(f"  UPLOAD {local} -> {remote}")
        try:
            self.sftp.put(str(local), remote)
            return True
        except Exception as e:
            print(f"  UPLOAD FAILED: {e}")
            return False

    def put_dir(self, local, remote):
        local = Path(local)
        print(f"  UPLOAD DIR {local} -> {remote}")
        try:
            self.exec_cmd(f"mkdir -p {remote}", "")
            for root, dirs, files in os.walk(local):
                # Normalize to forward slashes for SFTP
                rel = Path(root).relative_to(local).as_posix()
                remote_sub = remote if rel == '.' else f"{remote}/{rel}"
                if rel != '.':
                    self.exec_cmd(f"mkdir -p {remote_sub}", "")
                for f in files:
                    lf = Path(root) / f
                    rf = f"{remote_sub}/{f}"
                    try:
                        self.sftp.put(str(lf), rf)
                    except Exception as e:
                        print(f"    FAILED {lf}: {e}")
                        return False
            return True
        except Exception as e:
            print(f"  DIR UPLOAD FAILED: {e}")
            return False

    def close(self):
        if self.sftp:
            self.sftp.close()
        self.client.close()


def main():
    deployer = Deployer()

    # Step 1: Connect
    if not deployer.connect():
        sys.exit(1)

    # Step 2: Probe server
    print("\n=== Server Info ===")
    deployer.exec_cmd("uname -a", "OS info")
    deployer.exec_cmd("node -v 2>/dev/null || echo 'no node'", "Node version")
    deployer.exec_cmd("npm -v 2>/dev/null || echo 'no npm'", "NPM version")
    deployer.exec_cmd("pm2 -v 2>/dev/null || echo 'no pm2'", "PM2 version")
    deployer.exec_cmd("free -h 2>/dev/null || free -m", "Memory")
    deployer.exec_cmd("df -h / 2>/dev/null", "Disk")

    # Step 3: Clean remote tmp
    print("\n=== Prepare Remote ===")
    deployer.exec_cmd(f"rm -rf {REMOTE_TMP} && mkdir -p {REMOTE_TMP}", "Clean temp dir")

    # Step 4: Upload backend
    print("\n=== Upload Backend ===")
    backend_dist = PROJECT_DIR / "server" / "dist"
    if not (backend_dist / "server.js").exists():
        print("ERROR: backend dist/server.js not found")
        deployer.close()
        sys.exit(1)
    deployer.put_dir(backend_dist, f"{REMOTE_TMP}/server/dist")
    deployer.put_dir(PROJECT_DIR / "server" / "prisma", f"{REMOTE_TMP}/server/prisma")
    deployer.put_file(PROJECT_DIR / "server" / "package.json", f"{REMOTE_TMP}/server/package.json")
    pkg_lock = PROJECT_DIR / "server" / "package-lock.json"
    if pkg_lock.exists():
        deployer.put_file(pkg_lock, f"{REMOTE_TMP}/server/package-lock.json")

    # Step 5: Upload frontend
    print("\n=== Upload Frontend ===")
    client_dist = PROJECT_DIR / "client" / "dist"
    if (client_dist / "index.html").exists():
        deployer.put_dir(client_dist, f"{REMOTE_TMP}/client/dist")
    else:
        print("WARNING: frontend dist not found, backend only mode")

    # Step 6: Upload deploy script
    print("\n=== Upload Deploy Script ===")
    deployer.put_file(DEPLOY_DIR / "run.sh", f"{REMOTE_TMP}/run.sh")

    # Step 7: Run deployment
    print("\n=== Run Deploy Script ===")
    deployer.exec_cmd("chmod +x /tmp/clmx-deploy/run.sh", "Make executable")
    deployer.exec_cmd("bash /tmp/clmx-deploy/run.sh", "Deploy")

    # Step 8: Verify
    print("\n=== Verify ===")
    time.sleep(3)
    deployer.exec_cmd("pm2 status", "PM2 status")
    deployer.exec_cmd("pm2 logs clmx --lines 15 --nostream", "Recent logs")

    print("\n=== Health Check ===")
    deployer.exec_cmd(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/api/health 2>/dev/null || echo 'NO_RESPONSE'",
        "API health check"
    )

    print("\n" + "=" * 50)
    print(f"  Deployment complete!")
    print(f"  URL: http://{HOST}:3002")
    print("=" * 50)

    deployer.close()


if __name__ == "__main__":
    main()
