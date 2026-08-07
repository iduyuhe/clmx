import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app'
import { mockPrisma } from './__mocks__/prisma'
import { config } from '../src/utils/config'

const app = createApp()

beforeEach(() => {
  jest.clearAllMocks()
})

// 生成有效 token
function makeToken(userId = 'u1', tenantId = 't1') {
  return jwt.sign({ userId, tenantId }, config.jwtSecret, { expiresIn: '1h' } as any)
}

describe('鉴权守卫测试', () => {
  const endpoints = [
    { method: 'get', url: '/api/dashboard' },
    { method: 'get', url: '/api/datasets' },
    { method: 'get', url: '/api/models' },
    { method: 'get', url: '/api/training' },
    { method: 'get', url: '/api/deployments' },
    { method: 'get', url: '/api/settings/tenant' },
    { method: 'get', url: '/api/users' },
  ]

  endpoints.forEach(({ method, url }) => {
    it(`${method.toUpperCase()} ${url} 无 Token 返回 401`, async () => {
      const res = await (request(app) as any)[method](url)
      expect(res.status).toBe(401)
    })
  })

  it('GET /api/auth/me 有效 Token 返回用户信息', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'test@test.com', name: 'Test',
      role: 'ADMIN', tenantId: 't1',
      tenant: { id: 't1', name: 'Test Co' },
    })

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data.email).toBe('test@test.com')
    expect(res.body.data.passwordHash).toBeUndefined()
  })

  it('GET /api/auth/me 无效 Token 返回 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token-here')

    expect(res.status).toBe(401)
  })
})
