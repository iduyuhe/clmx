import request from 'supertest'
import { createApp } from '../src/app'
import { mockPrisma } from './__mocks__/prisma'
import bcrypt from 'bcryptjs'

const app = createApp()

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/auth/register', () => {
  it('必填字段缺失返回 400', async () => {
    const res = await request(app).post('/api/auth/register').send({})
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('邮箱格式无效返回 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-email', password: '123456', name: 'Test', companyName: 'Test Co' })
    expect(res.status).toBe(400)
  })

  it('密码太短返回 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: '123', name: 'Test', companyName: 'Test Co' })
    expect(res.status).toBe(400)
  })

  it('邮箱已注册返回 400', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: '1', email: 'test@test.com' })
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: '123456', name: 'Test', companyName: 'Test Co' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('该邮箱已注册')
  })

  it('成功注册返回 token + user', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null)
    mockPrisma.tenant.create.mockResolvedValueOnce({
      id: 't1', name: 'Test Co', slug: 'test-co-123',
      branding: '{}',
    })
    const hash = await bcrypt.hash('123456', 10)
    mockPrisma.user.create.mockResolvedValueOnce({
      id: 'u1', email: 'test@test.com', passwordHash: hash,
      name: 'Test', role: 'ADMIN', tenantId: 't1',
      tenant: { id: 't1', name: 'Test Co' },
    })

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: '123456', name: 'Test', companyName: 'Test Co' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.token).toBeDefined()
    expect(res.body.data.user.email).toBe('test@test.com')
    expect(res.body.data.user.passwordHash).toBeUndefined()
  })
})

describe('POST /api/auth/login', () => {
  it('缺少凭据返回 400', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).toBe(400)
  })

  it('用户不存在返回 401', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'none@test.com', password: '123456' })
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('邮箱或密码错误')
  })

  it('密码错误返回 401', async () => {
    const hash = await bcrypt.hash('correct', 10)
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'test@test.com', passwordHash: hash,
      tenantId: 't1', tenant: { id: 't1' },
    })
    mockPrisma.user.update.mockResolvedValueOnce({})
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'wrong_password' })
    expect(res.status).toBe(401)
  })

  it('正确凭据返回 token + user', async () => {
    const hash = await bcrypt.hash('123456', 10)
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'test@test.com', passwordHash: hash,
      tenantId: 't1', tenant: { id: 't1', name: 'Test Co' },
    })
    mockPrisma.user.update.mockResolvedValueOnce({})

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: '123456' })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeDefined()
  })
})
