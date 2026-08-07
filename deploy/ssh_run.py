"""SSH 密码自动登录并执行命令/上传文件"""
import subprocess
import sys
import os
import time

HOST = "43.153.172.52"
USER = "root"
PASSWORD = "Duyuhe2004"
KEY_FILE = os.path.join(os.path.dirname(__file__), "deploy_key")

def ssh_command(cmd, timeout=60):
    """通过 SSH key 执行远程命令"""
    # 先确保 key 已添加到服务器，如果 key 方式不行，尝试用密码
    env = os.environ.copy()
    # 使用 SSH key
    result = subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
         "-i", KEY_FILE, f"{USER}@{HOST}", cmd],
        capture_output=True, text=True, timeout=timeout, env=env
    )
    if result.returncode != 0:
        print(f"SSH Error: {result.stderr}")
        return None
    return result.stdout

def scp_upload(local_path, remote_path, timeout=60):
    """上传单个文件"""
    result = subprocess.run(
        ["scp", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
         "-i", KEY_FILE, local_path, f"{USER}@{HOST}:{remote_path}"],
        capture_output=True, text=True, timeout=timeout
    )
    return result.returncode == 0

def scp_upload_dir(local_dir, remote_dir, timeout=120):
    """递归上传目录"""
    result = subprocess.run(
        ["scp", "-r", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
         "-i", KEY_FILE, local_dir, f"{USER}@{HOST}:{remote_dir}"],
        capture_output=True, text=True, timeout=timeout
    )
    return result.returncode == 0

def ensure_key_installed(max_retries=3):
    """通过 ssh-copy-id 安装公钥（需要密码）"""
    for i in range(max_retries):
        print(f"尝试安装 SSH Key (第 {i+1}/{max_retries} 次)...")
        proc = subprocess.Popen(
            ["ssh-copy-id", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
             "-i", f"{KEY_FILE}.pub", f"{USER}@{HOST}"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        stdout, stderr = proc.communicate(input=f"{PASSWORD}\n", timeout=15)
        if proc.returncode == 0:
            print("SSH Key 安装成功!")
            return True
        print(f"  stdout: {stdout.strip()}")
        print(f"  stderr: {stderr.strip()}")
        time.sleep(2)
    return False

def check_key_works():
    """检查 key 认证是否已工作"""
    output = ssh_command("echo 'OK'", timeout=10)
    return output is not None and "OK" in output

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"

    if mode == "check":
        if check_key_works():
            print("SSH Key 认证正常")
            # 探测服务器信息
            info = ssh_command("uname -a && cat /etc/os-release 2>/dev/null | head -3 && node -v 2>/dev/null && npm -v 2>/dev/null && pm2 -v 2>/dev/null")
            print(info or "无法获取服务器信息")
        else:
            print("SSH Key 未配置或认证失败")
            # 尝试安装 key
            if ensure_key_installed():
                if check_key_works():
                    print("✅ Key 安装成功，SSH 认证正常")
                else:
                    print("❌ Key 安装后仍无法连接")
            else:
                print("❌ 无法自动安装 SSH Key")

    elif mode == "install-key":
        ensure_key_installed()

    elif mode == "upload":
        local = sys.argv[2]
        remote = sys.argv[3]
        if scp_upload(local, remote):
            print(f"上传成功: {local} -> {remote}")
        else:
            print(f"上传失败: {local}")

    elif mode == "upload-dir":
        local = sys.argv[2]
        remote = sys.argv[3]
        if scp_upload_dir(local, remote):
            print(f"目录上传成功: {local} -> {remote}")
        else:
            print(f"目录上传失败: {local}")

    elif mode == "run":
        cmd = " ".join(sys.argv[2:])
        output = ssh_command(cmd)
        if output:
            print(output)

    else:
        print(f"未知模式: {mode}")

if __name__ == "__main__":
    main()
