"""Live multi-tenant isolation e2e against the production PG instance (port 3003).
Proves: (1) migrated data is tenant-scoped on PG, (2) cross-tenant reads are blocked.
"""
import urllib.request
import urllib.error
import json
import uuid

BASE = "http://43.153.172.52:3003"

def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        code = resp.status
        raw = resp.read().decode() or '{}'
    except urllib.error.HTTPError as e:
        code = e.code
        raw = e.read().decode() or '{}'
    try:
        j = json.loads(raw)
    except Exception:
        j = {}
    return code, j

def rid(j):
    d = j.get('data')
    if isinstance(d, dict):
        return d.get('id') or (d.get('data') or {}).get('id')
    return None

def plist(j):
    d = j.get('data')
    if isinstance(d, dict):
        v = d.get('data')
        return v if isinstance(v, list) else []
    return d if isinstance(d, list) else []

results = []
def check(name, cond, detail=""):
    results.append(cond)
    print(("PASS " if cond else "FAIL ") + name + (("  | " + detail) if detail else ""))

# 1. admin login (PG)
code, j = req('POST', '/api/auth/login', {"email": "test@test.com", "password": "123456"})
check("admin login 200", code == 200, f"code={code}")
token0 = (j.get('data') or {}).get('token')
check("admin token present", bool(token0))

# 2. PG read: admin sees the 2 migrated devices (tenant-scoped)
code, j = req('GET', '/api/devices', token=token0)
devs = plist(j)
check("PG read: admin sees 2 migrated devices", code == 200 and len(devs) == 2, f"code={code} n={len(devs)}")

# 3. register a second tenant B
emailB = f"isoB{uuid.uuid4().hex[:8]}@example.com"
code, j = req('POST', '/api/auth/register', {"email": emailB, "password": "password123", "name": "IsoB", "companyName": "IsoB Co"})
check("register tenant B 200", code == 200, f"code={code}")
tokenB = (j.get('data') or {}).get('token')
check("tenant B token present", bool(tokenB))

# 4. admin creates device0
code, j = req('POST', '/api/devices', {"name": "IsoDev0", "code": "ISO0", "category": "PUMP"}, token=token0)
check("admin create device 200", code == 200, f"code={code}")
device0 = rid(j)
check("device0 id present", bool(device0), f"id={device0}")

# 5. B cannot read A's device -> 404
code, _ = req('GET', f'/api/devices/{device0}', token=tokenB)
check("isolation: B cannot read A device (404)", code == 404, f"code={code}")

# 6. B's own device list is empty
code, j = req('GET', '/api/devices', token=tokenB)
check("isolation: B has 0 devices", code == 200 and len(plist(j)) == 0, f"code={code} n={len(plist(j))}")

# 7. A can read own device
code, _ = req('GET', f'/api/devices/{device0}', token=token0)
check("A can read own device (200)", code == 200, f"code={code}")

# 8. B creates deviceB; A cannot read it
code, j = req('POST', '/api/devices', {"name": "IsoDevB", "code": "ISOB", "category": "PUMP"}, token=tokenB)
deviceB = rid(j)
code, _ = req('GET', f'/api/devices/{deviceB}', token=token0)
check("isolation: A cannot read B device (404)", code == 404, f"code={code}")

# cleanup
if device0:
    req('DELETE', f'/api/devices/{device0}', token=token0)
if deviceB:
    req('DELETE', f'/api/devices/{deviceB}', token=tokenB)

passed = sum(1 for c in results if c)
print(f"\nRESULT: {'PASS' if passed == len(results) else 'FAIL'} ({passed}/{len(results)})")
