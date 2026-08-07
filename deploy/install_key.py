#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""SSH key installer via ssh-copy-id"""
import subprocess
import sys
import os

HOST = "43.153.172.52"
USER = "root"
PASSWORD = "Duyuhe2004"
KEY_FILE = os.path.join(os.path.dirname(__file__), "deploy_key.pub").replace("\\", "/")

def main():
    proc = subprocess.Popen(
        ["bash", "-c", f"ssh-copy-id -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i {KEY_FILE} {USER}@{HOST}"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )
    
    pwd_sent = False
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        try:
            text = line.decode('utf-8', errors='replace')
        except:
            text = str(line)
        print(text.rstrip())
        
        if b"password:" in line.lower() and not pwd_sent:
            proc.stdin.write((PASSWORD + "\n").encode())
            proc.stdin.flush()
            pwd_sent = True
            print("*** password sent ***")
    
    proc.wait(timeout=30)
    ok = proc.returncode == 0
    print("SUCCESS" if ok else "FAILED")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
