/**
 * CLMX 设备接入 — HTTP 推送摄入端点
 *
 * 设备 / 边缘网关通过 HTTP POST 上报遥测，与 MQTT / OPC-UA 共用同一套
 * 摄入链路（租户隔离 + 存储配额），区别在于鉴权方式与传输协议。
 *
 * 鉴权：复用租户 API Key（x-api-key / Authorization: Bearer / ?api_key=），
 *       服务端对明文做 sha256 后与 ApiKey.keyHash 比对，得到 tenantId。
 * 负载：单条对象 或 对象数组（批量）
 *   { sensorId, value, [timestamp], [quality] }
 *   { deviceCode, sensorChannel, value, [timestamp], [quality] }
 */
import { Router } from 'express'
import crypto from 'crypto'
import { prisma } from '../../utils/prisma'
import { incrementStorageUsed, QuotaExceededError } from '../tenant/quota'
import { asyncHandler } from '../../utils/asyncHandler'

const ingestRouter = Router()

type Pt = {
  sensorId?: string
  deviceCode?: string
  sensorChannel?: string
  value?: unknown
  timestamp?: string
  quality?: string
}

function resolveRawKey(req: any): string | null {
  const h = req.headers['x-api-key']
  if (typeof h === 'string' && h) return h
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim()
  if (typeof req.query?.api_key === 'string') return req.query.api_key
  return null
}

ingestRouter.post('/telemetry', asyncHandler(async (req, res) => {
  const rawKey = resolveRawKey(req)
  if (!rawKey) {
    return res.status(401).json({
      success: false,
      message: '缺少 API Key：请通过请求头 x-api-key / Authorization: Bearer <key> 或查询参数 ?api_key=<key> 提供',
    })
  }
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const apiKey = await prisma.apiKey.findFirst({ where: { keyHash, isActive: true } })
  if (!apiKey) {
    return res.status(403).json({ success: false, message: 'API Key 无效或已停用' })
  }
  const tenantId = apiKey.tenantId

  const body = req.body
  const points: Pt[] = Array.isArray(body) ? body : [body]
  if (!points.length) {
    return res.status(400).json({ success: false, message: '上报数据为空' })
  }

  const data = { accepted: 0, written: 0, skipped: 0, errors: [] as string[] }
  for (const p of points) {
    try {
      if (p == null || typeof p.value === 'undefined' || p.value === null) {
        data.skipped++
        data.errors.push('缺少 value')
        continue
      }
      const value = Number(p.value)
      if (Number.isNaN(value)) {
        data.skipped++
        data.errors.push('value 不是有效数字')
        continue
      }

      let sensorId: string | null = null
      if (p.sensorId) {
        const sensor = await prisma.sensor.findUnique({ where: { id: p.sensorId }, include: { device: true } })
        if (!sensor || sensor.device.tenantId !== tenantId) {
          data.skipped++
          data.errors.push(`sensorId=${p.sensorId} 不存在或无权限`)
          continue
        }
        sensorId = sensor.id
      } else if (p.deviceCode && p.sensorChannel) {
        const device = await prisma.device.findFirst({ where: { tenantId, code: p.deviceCode } })
        if (!device) {
          data.skipped++
          data.errors.push(`deviceCode=${p.deviceCode} 不存在`)
          continue
        }
        const sensor = await prisma.sensor.findFirst({ where: { deviceId: device.id, channel: p.sensorChannel } })
        if (!sensor) {
          data.skipped++
          data.errors.push(`sensorChannel=${p.sensorChannel} 不存在`)
          continue
        }
        sensorId = sensor.id
      } else {
        data.skipped++
        data.errors.push('须提供 sensorId 或 deviceCode+sensorChannel')
        continue
      }

      await incrementStorageUsed(tenantId, 1)
      const row = await prisma.sensorData.create({
        data: {
          sensorId,
          tenantId,
          value,
          quality: p.quality || 'GOOD',
          timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
        },
      })
      data.written++
      data.accepted++
      void row
    } catch (e: any) {
      if (e instanceof QuotaExceededError) {
        data.skipped++
        data.errors.push(e.message)
        continue
      }
      data.skipped++
      data.errors.push(e?.message || '写入失败')
    }
  }

  res.json({ success: true, data })
}))

export default ingestRouter
