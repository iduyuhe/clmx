import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3002'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
}

// ─── 常量（魔术数字抽取）──────────────────────────────
export const BCRYPT_SALT_ROUNDS = 10
export const API_KEY_LENGTH = 16
export const TRAINING_DEFAULT_EPOCHS = 5
export const TRAINING_DEFAULT_BATCH_SIZE = 16
export const TRAINING_DEFAULT_LEARNING_RATE = 0.001
