"""阶段4·SaaS增值 线上验证（端口 3003）：租户设置/品牌白标 + 配额拦截。
测试租户用完即清理。"""
import os, sys, time, random, string, json
import urllib.request, urllib.error
import paramiko

HOST = os.environ.get('CLMX_HOST', '43.153.172.52')
USER = os.environ.get('CLMX_USER', 'root')
PASS = os.environ.get('CLMX_SSH_PASS')
BASE = f'http://{HOST}:3003'

def req(m, p, b=None, t=None):
    h = {'Content-Type': 'application/json'}
    if t: h['Authorization'] = 'Bearer ' + t
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, headers=h, method=m)
    try:
        with urllib.request.urlopen(r, timeout=90) as x:
            return x.status, json.loads(x.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except: return e.code, {'raw': e.read().decode()[:200]}
    except Exception as e:
        return 0, {'error': str(e)[:200]}

def rand(n): return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))

results = []
def check(name, cond, extra=''):
    results.append(('PASS' if cond else 'FAIL', name, extra))
    print(('✅' if cond else '❌'), name, extra)

def main():
    # 1) admin 登录
    s, b = req('POST', '/api/auth/login', {'email': 'test@test.com', 'password': '123456'})
    assert s == 200, f'login {s}'
    admin = b['data']['token']
    check('admin 登录', s == 200)

    # 2) GET /tenants/me 结构
    s, b = req('GET', '/api/tenants/me', t=admin)
    d = b.get('data', {})
    ok = s == 200 and d.get('branding') is not None and 'storageUsed' in d and 'apiCallQuota' in d and 'storageLimit' in d
    check('GET /tenants/me 结构完整', ok, str({k: d.get(k) for k in ['planType', 'storageUsed', 'storageLimit', 'apiCallQuota']}))
    orig_branding = d.get('branding')

    # 3) PATCH 品牌白标
    new_brand = {'companyName': 'CLMX 演示租户', 'primaryColor': '#ff6600', 'logoUrl': 'https://example.com/logo.png'}
    s, b = req('PATCH', '/api/tenants/me', {'branding': new_brand}, t=admin)
    got = b.get('data', {}).get('branding', {})
    ok = s == 200 and got.get('primaryColor') == '#ff6600'
    check('PATCH 品牌白标持久化', ok, f"primaryColor={got.get('primaryColor')}")
    # 还原
    req('PATCH', '/api/tenants/me', {'branding': orig_branding}, t=admin)

    # 4) 注册测试租户 T
    email = f'saas{rand(8)}@test.com'
    s, b = req('POST', '/api/auth/register', {'email': email, 'password': 'saas123', 'name': 'SaaS测试', 'companyName': 'SaaS测试公司'})
    assert s == 200, f'register {s}: {b}'
    tTok = b['data']['token']
    tid = b['data']['user']['tenant']['id']
    check('注册测试租户', s == 200, f'tid={tid[:8]}')

    # 5) 设备 + 传感器
    s, b = req('POST', '/api/devices', {'name': 'SaaS设备', 'code': 'SAAS-' + rand(4), 'category': 'pump'}, t=tTok)
    devId = b['data']['id']
    s, b = req('POST', f'/api/devices/{devId}/sensors', {'name': '振动', 'channel': 'vibration', 'unit': 'mm/s'}, t=tTok)
    sid = b['data']['id']
    check('创建设备+传感器', bool(sid), f'sensor={sid[:8]}')

    # 6) 存储配额：TRIAL(上限50) → 摄入100 应 429
    req('PATCH', '/api/tenants/me', {'planType': 'TRIAL'}, t=tTok)
    batch = [{'value': round(0.5 + 0.1 * i, 3), 'timestamp': f'2026-07-14T{(i%24):02d}:00:00Z'} for i in range(100)]
    s, b = req('POST', f'/api/sensor-data/ingest/batch', {'sensorId': sid, 'data': batch}, t=tTok)
    check('存储超配额拦截 429', s == 429, f'status={s} msg={b.get("message","")[:40]}')

    # 7) 存储配额内：摄入 10 应 200，storageUsed 变为 10
    batch10 = [{'value': 0.5, 'timestamp': f'2026-07-14T{(i)%24:02d}:30:00Z'} for i in range(10)]
    s, b = req('POST', f'/api/sensor-data/ingest/batch', {'sensorId': sid, 'data': batch10}, t=tTok)
    s2, b2 = req('GET', '/api/tenants/me', t=tTok)
    used = b2['data']['storageUsed']
    check('配额内摄入成功 + storageUsed 累加', s == 200 and used == 10, f'ingest={s} storageUsed={used}')

    # 7b) 切回 FREE 套餐以摄入足量训练数据
    req('PATCH', '/api/tenants/me', {'planType': 'FREE'}, t=tTok)
    train_batch = [{'value': round(0.5 + 0.15 * (i % 10), 3), 'timestamp': f'2026-07-10T{(i//4)%24:02d}:{(i%4)*15:02d}:00Z'} for i in range(60)]
    s, b = req('POST', f'/api/sensor-data/ingest/batch', {'sensorId': sid, 'data': train_batch}, t=tTok)
    check('摄入训练数据 60 点', s == 200, f'ingest={s} inserted={b.get("data",{}).get("inserted")}')

    # 8) API 配额：训练(timeseries) → 部署 → apiCallQuota=1 → /test 两次，第二次 429
    s, b = req('POST', '/api/models', {'name': 'SaaS模型', 'industry': 'metal', 'scenario': 'x', 'baseModel': 'test', 'domain': 'INDUSTRIAL'}, t=tTok)
    modelId = b['data']['id']
    s, b = req('POST', '/api/training', {'modelId': modelId, 'hyperparams': {'dataType': 'timeseries', 'sensorId': sid, 'windowSize': 12, 'step': 6}}, t=tTok)
    jobId = b['data']['id']
    # 轮询
    mvId = None
    for _ in range(60):
        s, b = req('GET', f'/api/training/{jobId}', t=tTok)
        st = b.get('data', {}).get('status')
        if st in ('COMPLETED', 'FAILED'):
            break
        time.sleep(2)
    if st == 'COMPLETED':
        s, b = req('GET', f'/api/models/{modelId}/versions', t=tTok)
        vers = b.get('data', []) or []
        mvId = vers[0]['id'] if vers else None
    check('SaaS租户时序训练完成', mvId is not None, f'status={st} mv={str(mvId)[:8]}')
    if mvId:
        s, b = req('POST', '/api/deployments', {'modelVersionId': mvId, 'name': 'SaaS部署'}, t=tTok)
        depId = b['data']['id']
        req('PATCH', '/api/tenants/me', {'apiCallQuota': 1}, t=tTok)
        s1, _ = req('POST', f'/api/deployments/{depId}/test', {'input': '健康检测'}, t=tTok)
        s2, b2 = req('POST', f'/api/deployments/{depId}/test', {'input': '健康检测'}, t=tTok)
        # 首次调用可能因共享服务器无法下载 NLP 模型而 500，但用量已计入；第二次须被配额拦截 429
        check('API 配额拦截 429', s2 == 429, f'第1次={s1} 第2次={s2}')
        # 还原配额
        req('PATCH', '/api/tenants/me', {'apiCallQuota': 10000}, t=tTok)

    # 9) 清理测试租户（服务端脚本）
    cleanup_local = r'G:/clmx/server/scripts/cleanup_tenant.cjs'
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=PASS, timeout=30)
    sftp = client.open_sftp()
    sftp.put(cleanup_local, '/opt/clmx/server/scripts/cleanup_tenant.cjs')
    sftp.close()
    stdin, stdout, stderr = client.exec_command(f'cd /opt/clmx/server && node scripts/cleanup_tenant.cjs {tid}')
    out = stdout.read().decode().strip()
    print('   cleanup:', out, stderr.read().decode().strip())
    client.close()
    check('测试租户已清理', 'cleaned' in out, out)

    # 汇总
    fails = [r for r in results if r[0] == 'FAIL']
    print('\n=== SaaS e2e 结果 ===')
    for r in results: print(' ', r[0], r[1], r[2])
    print('RESULT:', 'PASS' if not fails else 'FAIL')

if __name__ == '__main__':
    main()
