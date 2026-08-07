import request from 'supertest'
import { createApp } from '../src/app'

const app = createApp()

describe('GET /api/health', () => {
  it('返回 200 且包含 success: true', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.timestamp).toBeDefined()
  })

  it('响应头包含 Helmet 安全头', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
  })
})
