// 服务端清理：按 FK 顺序删除某租户的全部数据（用于 e2e 测试隔离）
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const tid = process.argv[2]

async function main() {
  if (!tid) { console.log('no tid'); process.exit(1) }
  await prisma.apiUsage.deleteMany({ where: { tenantId: tid } })
  await prisma.apiKey.deleteMany({ where: { tenantId: tid } })
  await prisma.trainingLog.deleteMany({ where: { trainingJob: { model: { tenantId: tid } } } })
  await prisma.trainingJob.deleteMany({ where: { model: { tenantId: tid } } })
  await prisma.deployment.deleteMany({ where: { modelVersion: { model: { tenantId: tid } } } })
  await prisma.modelVersion.deleteMany({ where: { model: { tenantId: tid } } })
  await prisma.aiModel.deleteMany({ where: { tenantId: tid } })
  await prisma.annotation.deleteMany({ where: { dataset: { tenantId: tid } } })
  await prisma.dataVersion.deleteMany({ where: { dataset: { tenantId: tid } } })
  await prisma.dataset.deleteMany({ where: { tenantId: tid } })
  await prisma.healthScore.deleteMany({ where: { device: { tenantId: tid } } })
  await prisma.sensorData.deleteMany({ where: { sensor: { device: { tenantId: tid } } } })
  await prisma.sensor.deleteMany({ where: { device: { tenantId: tid } } })
  await prisma.maintenanceOrder.deleteMany({ where: { tenantId: tid } })
  await prisma.alertRule.deleteMany({ where: { tenantId: tid } })
  await prisma.device.deleteMany({ where: { tenantId: tid } })
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } })
  await prisma.user.deleteMany({ where: { tenantId: tid } })
  await prisma.tenant.deleteMany({ where: { id: tid } })
  console.log('cleaned ' + tid)
}

main().catch(e => { console.error(e); process.exit(2) }).finally(() => prisma.$disconnect())
