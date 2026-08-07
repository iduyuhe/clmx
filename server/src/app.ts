import express from 'express'
import path from 'path'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { ZodError } from 'zod'
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'
import { auditMiddleware } from './modules/audit/audit.middleware'
import authRoutes from './modules/auth/auth.routes'
import dashboardRoutes from './modules/dashboard/dashboard.routes'
import industryRoutes from './modules/industry/industry.routes'
import datasetRoutes from './modules/dataset/dataset.routes'
import modelRoutes from './modules/model/model.routes'
import trainingRoutes from './modules/training/training.routes'
import deploymentRoutes from './modules/deployment/deployment.routes'
import settingsRoutes from './modules/settings/settings.routes'
import usersRoutes from './modules/users/users.routes'
import annotationRoutes from './modules/annotation/annotation.routes'
import inferenceRoutes from './modules/inference/inference.routes'
import evaluationRoutes from './modules/evaluation/evaluation.routes'
import deviceRoutes from './modules/device/device.routes'
import sensorDataRoutes from './modules/sensor-data/sensor-data.routes'
import maintenanceRoutes from './modules/maintenance/maintenance.routes'
import healthRoutes from './modules/health/health.routes'
import tenantRoutes from './modules/tenant/tenant.routes'
import ingestRoutes from './modules/ingest/ingest.routes'
import notificationRoutes from './modules/notifications/notifications.routes'
import demoRoutes from './modules/demo/demo.routes'
import billingRoutes from './modules/billing/billing.routes'
import opcuaRoutes from './modules/opcua/opcua.routes'
import nlCommandRoutes from './modules/nl-command/nlCommand.routes'
import { apiLimiter, authLimiter } from './middleware/rateLimiter'
import logger from './utils/logger'

export function createApp() {
  const app = express()
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors())
  app.use(morgan('dev'))

  // Winston 结构化请求日志（记录请求体大小和响应时间）
  app.use((req, _res, next) => {
    const start = Date.now()
    _res.on('finish', () => {
      const duration = Date.now() - start
      if (_res.statusCode >= 400) {
        logger.warn(`${req.method} ${req.originalUrl} ${_res.statusCode}`, { duration, ip: req.ip })
      }
    })
    next()
  })
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: true }))

  // 审计日志中间件 — 在所有路由前，但对已认证请求自动记录 mutation 操作
  app.use(auditMiddleware)

  // Swagger API 文档
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title: 'CLMX API', version: '1.0.0', description: '融合型 AI 平台 REST API' },
      servers: [{ url: '/api', description: 'CLMX API' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key', description: '部署 API Key' },
        },
      },
    },
    apis: [path.resolve(__dirname, 'modules', '**', '*.routes.ts'), path.resolve(__dirname, 'modules', '**', '*.routes.js')],
  })
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css' }))

  // 速率限制
  app.use('/api/auth', authLimiter)
  app.use('/api/', apiLimiter)

  app.use('/api/auth', authRoutes)
  app.use('/api/dashboard', dashboardRoutes)
  app.use('/api/industries', industryRoutes)
  app.use('/api/datasets', annotationRoutes)
  app.use('/api/datasets', datasetRoutes)
  app.use('/api/models', modelRoutes)
  app.use('/api/training', trainingRoutes)
  app.use('/api/deployments', deploymentRoutes)
  app.use('/api/settings', settingsRoutes)
  app.use('/api/users', usersRoutes)
  app.use('/api/inference', inferenceRoutes)
  app.use('/api/evaluations', evaluationRoutes)
  app.use('/api/devices', deviceRoutes)
  app.use('/api/sensor-data', sensorDataRoutes)
  app.use('/api/maintenance', maintenanceRoutes)
  app.use('/api/health', healthRoutes)
  app.use('/api/tenants', tenantRoutes)
  app.use('/api/ingest', ingestRoutes)
  app.use('/api/notifications', notificationRoutes)
  app.use('/api/demo-data', demoRoutes)
  app.use('/api/billing', billingRoutes)
  app.use('/api/opcua', opcuaRoutes)
  app.use('/api/nl-command', nlCommandRoutes)

  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } })
  })

  // ─── 生产环境：托管前端静态文件 ──────────────────────────
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res, next) => {
    // 跳过 API 路由
    if (_req.path.startsWith('/api')) return next()
    res.sendFile(path.join(clientDist, 'index.html'))
  })

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      const msg = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      return res.status(400).json({ success: false, message: `参数校验失败: ${msg}` })
    }
    logger.error(err.message, { stack: err.stack })
    const statusCode = typeof err.status === 'number' ? err.status : 500
    res.status(statusCode).json({ success: false, message: err.message || '服务器错误' })
  })

  return app
}
