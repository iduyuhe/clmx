/**
 * 阶段3 多租户隔离 e2e（本地）
 * 启动真实后端，注册两个租户，验证：
 *  - 各子表创建时 tenantId 正确写入
 *  - 租户B 无法读/写租户A 的资源（路由层隔离）
 */
import { spawn } from 'child_process'

const PORT = 3499
const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function killTree(pid: number) {
  try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
  if (process.platform === 'win32') {
    try { require('child_process').execSync(`taskkill /F /T /PID ${pid}`) } catch { /* ignore */ }
  }
}

function clearPort(port: number) {
  try {
    const { execSync } = require('child_process')
    const out = execSync(`netstat -ano | findstr /R ":${port} "`).toString()
    const pids = new Set(out.split('\n').map((l: string) => (l.trim().split(/\s+/).pop() || '')).filter(Boolean))
    for (const p of pids) { try { execSync(`taskkill /F /T /PID ${p}`) } catch { /* ignore */ } }
  } catch { /* no occupant */ }
}

async function http(method: string, url: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data: any = null
  try { data = await res.json() } catch { /* no body */ }
  return { status: res.status, data }
}

async function main() {
  clearPort(PORT)
  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  server.stderr?.on('data', (d) => process.stderr.write(`[srv-err] ${d}`))

  let ready = false
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    try {
      const r = await http('POST', `${BASE}/api/auth/login`, { email: 'ready@check.com', password: '123456' })
      if (typeof r.status === 'number') { ready = true; break } // 任意响应都说明服务已起来
    } catch { /* not up yet */ }
  }
  if (!ready) {
    console.error('server not ready')
    server.kill('SIGKILL')
    process.exit(2)
  }

  const results: string[] = []
  let pass = true
  const check = (name: string, cond: boolean) => {
    results.push(`${cond ? 'PASS' : 'FAIL'} - ${name}`)
    if (!cond) pass = false
  }

  const ts = Date.now()
  const a = await http('POST', `${BASE}/api/auth/register`, { email: `a${ts}@iso.test`, password: 'password123', name: 'TenantA', companyName: 'CompanyA' })
  const b = await http('POST', `${BASE}/api/auth/register`, { email: `b${ts}@iso.test`, password: 'password123', name: 'TenantB', companyName: 'CompanyB' })
  check('register A 200', a.status === 200)
  check('register B 200', b.status === 200)
  const tokenA: string = a.data?.data?.token
  const tokenB: string = b.data?.data?.token
  const tenantA: string = a.data?.data?.user?.tenantId
  const tenantB: string = b.data?.data?.user?.tenantId
  check('token A present', !!tokenA)
  check('token B present', !!tokenB)

  const devA = await http('POST', `${BASE}/api/devices`, { name: 'Pump-A', code: `PUMP-A-${ts}` }, tokenA)
  check('A create device 200', devA.status === 200)
  const deviceIdA: string = devA.data?.data?.id

  const senA = await http('POST', `${BASE}/api/devices/${deviceIdA}/sensors`, { name: 'Temp', channel: 'T1' }, tokenA)
  check('A create sensor 200', senA.status === 200)
  const sensorIdA: string = senA.data?.data?.id

  const ing = await http('POST', `${BASE}/api/sensor-data/ingest`, { sensorId: sensorIdA, value: 25.5 }, tokenA)
  check('A ingest 200', ing.status === 200)

  const mdlA = await http('POST', `${BASE}/api/models`, { name: 'ModelA', industry: 'metal', scenario: 'x', baseModel: 'fasttext' }, tokenA)
  check('A create model 200', mdlA.status === 200)
  const modelIdA: string = mdlA.data?.data?.id

  const hA = await http('POST', `${BASE}/api/health/device/${deviceIdA}/calculate`, {}, tokenA)
  check('A health calc 200', hA.status === 200)

  // 跨租户读取 —— 必须 404
  const bDev = await http('GET', `${BASE}/api/devices/${deviceIdA}`, undefined, tokenB)
  check('B 读 A 设备 → 404', bDev.status === 404)
  const bSen = await http('GET', `${BASE}/api/devices/${deviceIdA}/sensors`, undefined, tokenB)
  check('B 列 A 传感器 → 404', bSen.status === 404)
  const bHist = await http('GET', `${BASE}/api/health/device/${deviceIdA}/history`, undefined, tokenB)
  check('B 读 A 健康历史 → 404', bHist.status === 404)
  const bMdl = await http('GET', `${BASE}/api/models/${modelIdA}`, undefined, tokenB)
  check('B 读 A 模型 → 404', bMdl.status === 404)
  const bIng = await http('POST', `${BASE}/api/sensor-data/ingest`, { sensorId: sensorIdA, value: 99 }, tokenB)
  check('B 写入 A 传感器 → 404', bIng.status === 404)

  // 数据库层校验 tenantId 已正确写入子表
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const sensor = await prisma.sensor.findUnique({ where: { id: sensorIdA } })
  check('sensor.tenantId === A', sensor?.tenantId === tenantA)
  const sd = await prisma.sensorData.findFirst({ where: { sensorId: sensorIdA } })
  check('sensorData.tenantId === A', sd?.tenantId === tenantA)
  const hs = await prisma.healthScore.findFirst({ where: { deviceId: deviceIdA } })
  check('healthScore.tenantId === A', hs?.tenantId === tenantA)
  const dv = await prisma.dataVersion.findFirst({ where: { datasetId: { equals: 'never-match' } } })
  void dv
  // A 的模型版本（训练后才产生，此处可能为空，跳过）
  await prisma.$disconnect()

  // B 自建资源，A 不可见
  const devB = await http('POST', `${BASE}/api/devices`, { name: 'Pump-B', code: `PUMP-B-${ts}` }, tokenB)
  check('B 建自己设备 200', devB.status === 200)
  const deviceIdB: string = devB.data?.data?.id
  const aSeesB = await http('GET', `${BASE}/api/devices/${deviceIdB}`, undefined, tokenA)
  check('A 读 B 设备 → 404', aSeesB.status === 404)

  // 先输出结果，再清理（清理失败不应掩盖测试结果）
  console.log(results.join('\n'))
  console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL')

  // 清理：按依赖顺序删除，避免 FK 约束冲突
  try {
    const { PrismaClient } = await import('@prisma/client')
    const pc = new PrismaClient()
    const tids = [tenantA, tenantB]
    await pc.healthScore.deleteMany({ where: { device: { tenantId: { in: tids } } } })
    await pc.sensorData.deleteMany({ where: { sensor: { device: { tenantId: { in: tids } } } } })
    await pc.sensor.deleteMany({ where: { device: { tenantId: { in: tids } } } })
    await pc.maintenanceOrder.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.alertRule.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.modelVersion.deleteMany({ where: { model: { tenantId: { in: tids } } } })
    await pc.trainingJob.deleteMany({ where: { model: { tenantId: { in: tids } } } })
    await pc.dataVersion.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.annotation.deleteMany({ where: { dataset: { tenantId: { in: tids } } } })
    await pc.aiModel.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.dataset.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.device.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.sparePart.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.apiKey.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.auditLog.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.user.deleteMany({ where: { tenantId: { in: tids } } })
    await pc.tenant.deleteMany({ where: { id: { in: tids } } })
    await pc.$disconnect()
  } catch (e) {
    console.error('cleanup warning:', (e as Error).message)
  }

  killTree(server.pid!)
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
