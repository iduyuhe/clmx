import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Check if tenant already exists
  let tenant = await prisma.tenant.findFirst()
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'CLMX 测试企业',
        slug: 'clmx-test-' + Date.now(),
        branding: JSON.stringify({ companyName: 'CLMX 测试企业', primaryColor: '#3b82f6', logoUrl: '', faviconUrl: '', customDomain: '' }),
      },
    })
    console.log('Created tenant:', tenant.id)
  } else {
    console.log('Using existing tenant:', tenant.id)
  }

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email: 'test@test.com' } })
  if (existing) {
    console.log('User already exists:', existing.email)
    return
  }

  const passwordHash = await bcrypt.hash('123456', 10)
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'test@test.com',
      passwordHash,
      name: '管理员',
      role: 'ADMIN',
    },
  })
  console.log('Created user:', user.email, 'role:', user.role)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
