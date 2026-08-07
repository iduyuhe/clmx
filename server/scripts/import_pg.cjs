/* Import /tmp/clmx_export.json into PostgreSQL via Prisma (CommonJS, runs with node).
 * FK-ordered inserts, tenantId backfilled (admin tenant sees all migrated data).
 * Re-runnable: TRUNCATE ... CASCADE first.
 * Run on server: DATABASE_URL=postgresql://clmx:...@127.0.0.1:5432/clmx node scripts/import_pg.cjs
 */
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')

const prisma = new PrismaClient()
const BIGINT_COLS = new Set(['storageUsed', 'apiCallQuota', 'fileSize'])
const BOOL_COLS = new Set(['isPreset', 'isActive', 'isEnabled'])
const DATETIME_COLS = new Set([
  'createdAt', 'updatedAt', 'lastLoginAt', 'installDate', 'dueDate', 'completedAt',
  'lastTriggeredAt', 'startedAt', 'timestamp',
])

const ORDER = [
  'Tenant', 'User', 'Industry', 'Scenario', 'Dataset', 'AiModel', 'Device', 'ApiKey',
  'DataVersion', 'Annotation', 'ModelVersion', 'TrainingJob', 'TrainingLog', 'Evaluation',
  'Deployment', 'ApiUsage', 'Sensor', 'SensorData', 'HealthScore', 'MaintenanceOrder',
  'SparePart', 'AlertRule', 'AuditLog',
]

function buildData(row) {
  const d = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue
    if (BIGINT_COLS.has(k)) { d[k] = BigInt(v); continue }
    if (BOOL_COLS.has(k) && typeof v === 'number') { d[k] = Boolean(v); continue }
    if (DATETIME_COLS.has(k) && typeof v === 'number') { d[k] = new Date(Number(v)).toISOString(); continue }
    d[k] = v
  }
  return d
}

async function main() {
  const raw = JSON.parse(fs.readFileSync('/tmp/clmx_export.json', 'utf-8'))

  let systemTenantId = (raw['Tenant'] || [])[0] && (raw['Tenant'] || [])[0].id
  const testUser = (raw['User'] || []).find((u) => u.email === 'test@test.com')
  if (testUser && testUser.tenantId) systemTenantId = testUser.tenantId
  console.log('systemTenantId =', systemTenantId)

  const tbl = ORDER.map((t) => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tbl} CASCADE`)
  console.log('truncated')

  const map = {}
  const setMap = (table, rows) => {
    const m = {}
    for (const r of rows) if (r.tenantId) m[r.id] = r.tenantId
    map[table] = m
  }

  const create = async (model, rows, resolve) => {
    const lower = model.charAt(0).toLowerCase() + model.slice(1)
    for (const r of rows) {
      const d = buildData(r)
      if (resolve) d.tenantId = resolve(r) || systemTenantId
      await prisma[lower].create({ data: d }).catch((e) => console.log(`${model} err:`, e.message))
    }
  }

  await create('Tenant', raw['Tenant'] || [])
  setMap('Tenant', raw['Tenant'] || [])
  await create('User', raw['User'] || [])
  await create('Industry', raw['Industry'] || [], () => systemTenantId)
  await create('Scenario', raw['Scenario'] || [], () => systemTenantId)
  await create('Dataset', raw['Dataset'] || [])
  setMap('Dataset', raw['Dataset'] || [])
  await create('AiModel', raw['AiModel'] || [])
  setMap('AiModel', raw['AiModel'] || [])
  await create('Device', raw['Device'] || [])
  setMap('Device', raw['Device'] || [])
  await create('ApiKey', raw['ApiKey'] || [])
  setMap('ApiKey', raw['ApiKey'] || [])

  await create('DataVersion', raw['DataVersion'] || [], (r) => map['Dataset'][r.datasetId])
  await create('Annotation', raw['Annotation'] || [], (r) => map['Dataset'][r.datasetId])
  await create('ModelVersion', raw['ModelVersion'] || [], (r) => map['AiModel'][r.modelId])
  await create('TrainingJob', raw['TrainingJob'] || [], (r) => map['AiModel'][r.modelId])
  setMap('TrainingJob', raw['TrainingJob'] || [])
  await create('TrainingLog', raw['TrainingLog'] || [], (r) => map['TrainingJob'][r.trainingJobId])
  await create('Evaluation', raw['Evaluation'] || [], (r) => map['ModelVersion'][r.modelVersionId])
  await create('Deployment', raw['Deployment'] || [], (r) => map['ModelVersion'][r.modelVersionId])
  setMap('Deployment', raw['Deployment'] || [])
  await create('ApiUsage', raw['ApiUsage'] || [], (r) => map['ApiKey'][r.apiKeyId])
  await create('Sensor', raw['Sensor'] || [], (r) => map['Device'][r.deviceId])
  setMap('Sensor', raw['Sensor'] || [])
  await create('SensorData', raw['SensorData'] || [], (r) => map['Sensor'][r.sensorId])
  await create('HealthScore', raw['HealthScore'] || [], (r) => map['Device'][r.deviceId])
  await create('MaintenanceOrder', raw['MaintenanceOrder'] || [])
  await create('SparePart', raw['SparePart'] || [])
  await create('AlertRule', raw['AlertRule'] || [])
  await create('AuditLog', raw['AuditLog'] || [])

  for (const t of ORDER) {
    const c = await prisma[t.charAt(0).toLowerCase() + t.slice(1)].count()
    console.log(t, c)
  }
  await prisma.$disconnect()
  console.log('IMPORT DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
