/**
 * CLMX MCP 北向 - HTTP 客户端封装
 *
 * 设计原则（呼应 HubPort「调用有边界」）：
 * - MCP server 本身不持有任何业务逻辑，全部通过内部 HTTP 调 CLMX 主服务既有 API。
 * - 鉴权由主服务 authMiddleware 完成（JWT + 租户 + 角色），MCP 层只是「传递令牌」。
 * - 每个工具的实际权限 = 传入 token 对应角色的权限；越权由主服务 403 拦截。
 * - 支持 CLMX_API_TOKEN 直传，或 CLMX_API_EMAIL/PASSWORD 启动时自动登录兜底。
 */
import logger from '../../utils/logger'

export interface ClmxClientConfig {
  baseUrl: string
  token?: string
  email?: string
  password?: string
}

let cachedToken: string | null = null

/** 获取调用主服务所需的 Bearer token（带缓存 + 自动登录兜底） */
export async function resolveToken(cfg: ClmxClientConfig): Promise<string> {
  if (cfg.token) return cfg.token
  if (cachedToken) return cachedToken
  if (cfg.email && cfg.password) {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cfg.email, password: cfg.password }),
      })
      const json: any = await res.json().catch(() => null)
      const token = json?.data?.token
      if (!token) {
        throw new Error(`CLMX 自动登录失败: ${json?.message || res.status}`)
      }
      cachedToken = token
      return token
    } catch (err: any) {
      throw new Error(`CLMX 自动登录异常: ${err.message}`)
    }
  }
  throw new Error('缺少 CLMX_API_TOKEN，或未配置 CLMX_API_EMAIL/CLMX_API_PASSWORD 自动登录')
}

export interface ClmxCallResult {
  isError: boolean
  text: string
}

/**
 * 调用 CLMX 主服务 API。
 * 统一把主服务 `{ success, data, message }` 结构归一为可读文本。
 */
export async function clmxCall(
  cfg: ClmxClientConfig,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ClmxCallResult> {
  const token = await resolveToken(cfg)
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = null
    }

    if (!res.ok) {
      const msg = json?.message || `HTTP ${res.status}`
      return { isError: true, text: `CLMX API 错误 (${res.status}): ${msg}` }
    }
    // 业务失败但 HTTP 200
    if (json && json.success === false) {
      return { isError: true, text: `CLMX 业务错误: ${json.message || '未知错误'}` }
    }
    const payload = json && json.success ? json.data : json
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
    return { isError: false, text }
  } catch (err: any) {
    logger.error('[clmx-mcp] 调用主服务失败', { error: err.message, url })
    return { isError: true, text: `无法连接 CLMX 主服务 (${cfg.baseUrl}): ${err.message}` }
  }
}
