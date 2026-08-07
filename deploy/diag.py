import paramiko, socket
HOST = "43.153.172.52"; USER = "root"; PW = "Duyuhe2004"

try:
    s = socket.socket(); s.settimeout(6); s.connect((HOST, 22))
    print("PORT22 BANNER:", s.recv(80).decode(errors='replace').strip()); s.close()
except Exception as e:
    print("PORT22 ERR:", e)

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect(HOST, username=USER, key_filename='G:/clmx/deploy/deploy_key',
             timeout=15, look_for_keys=False, allow_agent=False)
    print("KEY AUTH: OK"); c.close()
except Exception as e:
    print("KEY AUTH FAIL:", type(e).__name__, str(e)[:150])

try:
    c.connect(HOST, username=USER, password=PW, timeout=15, look_for_keys=False, allow_agent=False)
    print("PW AUTH: OK"); c.close()
except Exception as e:
    print("PW AUTH FAIL:", type(e).__name__, str(e)[:150])
