/**
 * CLMX MCP 北向 - stdio 服务入口
 *
 * 为什么不引入官方 MCP SDK：
 * - CLMX 护城河是「零依赖边缘 JS 推理」，北向能力底座也应保持轻量、可控。
 * - MCP 协议本质是 JSON-RPC 2.0 over NDJSON（stdio 传输），核心方法仅 4 个
 *   （initialize / tools/list / tools/call / ping），自实现可靠且零外部依赖。
 * - 业务全部走既有 REST API（见 client.ts / tools.ts），本文件只做协议翻译。
 *
 * 启动（由 MCP 客户端 spawn 子进程）：
 *   CLMX_API_URL=http://localhost:3100 CLMX_API_TOKEN=<jwt> npx tsx src/modules/mcp/mcp.server.ts
 * 或不传 token，改用邮箱密码自动登录：
 *   CLMX_API_EMAIL=... CLMX_API_PASSWORD=... npx tsx src/modules/mcp/mcp.server.ts
 *
 * 注意：stdout 只能输出 JSON-RPC 消息（NDJSON），任何日志必须写 stderr。
 */
import * as readline from 'readline'
import { MCP_TOOLS } from './tools'
import { ClmxClientConfig } from './client'

const cfg: ClmxClientConfig = {
  baseUrl: process.env.CLMX_API_URL || 'http://localhost:3100',
  token: process.env.CLMX_API_TOKEN,
  email: process.env.CLMX_API_EMAIL,
  password: process.env.CLMX_API_PASSWORD,
}

const PROTOCOL_VERSION = '2024-11-05'

function log(...args: any[]): void {
  const s = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  process.stderr.write(`[clmx-mcp] ${s}\n`)
}

function send(msg: Record<string, any>): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function errorResponse(id: any, code: number, message: string): Record<string, any> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleMessage(msg: any): Promise<void> {
  const id = msg?.id
  const method: string | undefined = msg?.method
  const params = msg?.params || {}

  if (!method) {
    if (id !== undefined) send(errorResponse(id, -32600, 'Invalid Request: missing method'))
    return
  }

  // 通知（无 id）不需要回响应
  const isNotification = id === undefined

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'clmx-mcp', version: '1.0.0' },
        },
      })
      return

    case 'notifications/initialized':
      // 客户端初始化完成通知，无响应
      return

    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} })
      return

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      })
      return

    case 'tools/call': {
      const name: string = params.name
      const args: Record<string, any> = params.arguments || {}
      const tool = MCP_TOOLS.find((t) => t.name === name)
      if (!tool) {
        if (!isNotification) send(errorResponse(id, -32602, `Unknown tool: ${name}`))
        return
      }
      try {
        const result = await tool.handler(args, cfg)
        if (!isNotification) {
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: result.text }],
              isError: result.isError,
            },
          })
        }
      } catch (e: any) {
        if (!isNotification) {
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `工具执行异常: ${e?.message || String(e)}` }],
              isError: true,
            },
          })
        }
      }
      return
    }

    default:
      if (!isNotification) send(errorResponse(id, -32601, `Method not found: ${method}`))
      return
  }
}

// ─── stdio 传输（NDJSON，每行一条 JSON-RPC 消息） ──────────────
let pending = 0
let inputClosed = false

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  pending++
  try {
    const msg = JSON.parse(trimmed)
    await handleMessage(msg)
  } catch (e: any) {
    log('跳过无法解析的行:', e?.message || String(e))
  } finally {
    pending--
    // 输入已关闭且所有在途请求处理完毕，再优雅退出（避免提前杀死未完成的 tools/call 响应）
    if (inputClosed && pending === 0) process.exit(0)
  }
})

rl.on('close', () => {
  inputClosed = true
  if (pending === 0) process.exit(0)
})

process.on('uncaughtException', (e) => log('uncaughtException:', e?.message || String(e)))
process.on('unhandledRejection', (e) => log('unhandledRejection:', String(e)))

log(`CLMX MCP server 已启动 | baseUrl=${cfg.baseUrl} | 工具数=${MCP_TOOLS.length}`)
