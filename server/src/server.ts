import { createApp } from './app'
import { config } from './utils/config'
import logger from './utils/logger'

// BigInt JSON 序列化支持（SQLite + Prisma 返回 BigInt 字段）
;(BigInt.prototype as unknown as { toJSON: () => number | string }).toJSON = function () {
  const n = Number(this)
  return Number.isSafeInteger(n) ? n : this.toString()
}

const app = createApp()

app.listen(config.port, () => {
  logger.info(`Server started`, { port: config.port, env: process.env.NODE_ENV || 'development' })
})
