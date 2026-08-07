/**
 * CLMX OPC-UA 接入适配器
 *
 * 通过 OPC-UA 协议从工业现场（PLC / SCADA / 边缘网关）订阅变量节点，将实时值
 * 写入 SensorData，与 HTTP 推送、MQTT 共用同一套摄入链路（租户隔离 + 存储配额）。
 *
 * 设计：采用「会话 + 定时轮询 read」的稳健模式，避免 subscription 在弱网下反复重连；
 *       每个 mapping 对应一个 OPC-UA 节点 → 一个传感器。拿到值后复用 ingest 的
 *       incrementStorageUsed + SensorData 写入。
 *
 * 启动方式：经管理端点 /api/opcua/connect 动态连接（便于演示），无需改动 server 启动流程。
 */
import type { OPCUAClient } from 'node-opcua'
import { prisma } from '../../utils/prisma'
import { incrementStorageUsed, QuotaExceededError } from '../tenant/quota'
import logger from '../../utils/logger'

export interface OpcuaMapping {
  nodeId: string
  sensorId: string
  tenantId: string
}

interface OpcuaState {
  client: OPCUAClient
  session: any
  timer: NodeJS.Timeout
  endpoint: string
  mappings: OpcuaMapping[]
}

let active: OpcuaState | null = null

export interface ConnectResult {
  connected: boolean
  endpoint: string
  nodes: number
}

export async function connectOpcua(opts: {
  endpoint: string
  mappings: OpcuaMapping[]
  intervalMs?: number
}): Promise<ConnectResult> {
  if (active) await disconnectOpcua()

  // 动态加载可选依赖，避免未安装 node-opcua 时拖垮整个后端启动
  const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = await import('node-opcua')

  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    requestedSessionTimeout: 30_000,
  })

  await client.connect(opts.endpoint)
  const session = await client.createSession()

  const interval = Math.max(1000, opts.intervalMs || 5000)
  const timer = setInterval(async () => {
    for (const m of opts.mappings) {
      try {
        const dataValue = await session.readVariableValue(m.nodeId)
        const raw = dataValue?.value?.value
        const value = typeof raw === 'number' ? raw : Number(raw)
        if (Number.isNaN(value)) continue
        try {
          await incrementStorageUsed(m.tenantId, 1)
        } catch (e) {
          if (!(e instanceof QuotaExceededError)) logger.warn('OPC-UA 配额更新失败', { err: (e as Error)?.message })
        }
        await prisma.sensorData.create({
          data: { sensorId: m.sensorId, tenantId: m.tenantId, value, quality: 'GOOD' },
        })
      } catch (e: any) {
        logger.warn('OPC-UA 读点失败', { nodeId: m.nodeId, err: e?.message })
      }
    }
  }, interval)

  active = { client, session, timer, endpoint: opts.endpoint, mappings: opts.mappings }
  logger.info('OPC-UA 适配器已连接', { endpoint: opts.endpoint, nodes: opts.mappings.length })
  return { connected: true, endpoint: opts.endpoint, nodes: opts.mappings.length }
}

export async function disconnectOpcua(): Promise<void> {
  if (!active) return
  if (active.timer) clearInterval(active.timer)
  try {
    await active.session.close()
  } catch {
    /* ignore */
  }
  try {
    await active.client.disconnect()
  } catch {
    /* ignore */
  }
  active = null
  logger.info('OPC-UA 适配器已断开')
}

export function opcuaStatus(): { connected: boolean; endpoint: string | null; nodes: number } {
  return {
    connected: !!active,
    endpoint: active?.endpoint ?? null,
    nodes: active?.mappings.length ?? 0,
  }
}
