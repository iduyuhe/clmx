/**
 * 文件解析工具 — 支持 CSV / JSONL / JSON 格式
 */
import * as fs from 'fs'
import logger from './logger'

export interface FileParseResult {
  rowCount: number
  preview: Record<string, unknown>[]  // 前 10 行预览
  headers?: string[]                   // CSV 表头
  format: string
}

export function parseDatasetFile(filePath: string, originalName: string): FileParseResult {
  const ext = (originalName || '').split('.').pop()?.toLowerCase() || 'txt'

  switch (ext) {
    case 'csv':
      return parseCSV(filePath)
    case 'jsonl':
      return parseJSONL(filePath)
    case 'json':
      return parseJSON(filePath)
    default:
      return parseText(filePath, ext.toUpperCase())
  }
}

function parseCSV(filePath: string): FileParseResult {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.trim().split(/\r?\n/)
  if (lines.length === 0) return { rowCount: 0, preview: [], format: 'CSV' }

  const headers = parseCSVLine(lines[0])
  const dataLines = lines.slice(1).filter(l => l.trim())
  const preview = dataLines.slice(0, 10).map(line => {
    const values = parseCSVLine(line)
    const row: Record<string, unknown> = {}
    headers.forEach((h, i) => { row[h] = values[i] || '' })
    return row
  })

  return {
    rowCount: dataLines.length,
    preview,
    headers,
    format: 'CSV',
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseJSONL(filePath: string): FileParseResult {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim())
  const preview: Record<string, unknown>[] = []

  let validCount = 0
  for (let i = 0; i < Math.min(lines.length, 1000); i++) {
    try {
      const obj = JSON.parse(lines[i])
      validCount++
      if (i < 10) preview.push(obj)
    } catch {
      // skip invalid lines
    }
  }

  // 如果有超过 1000 行，快速计数剩余行
  if (lines.length > 1000) {
    let extra = 0
    for (let i = 1000; i < lines.length; i++) {
      try {
        JSON.parse(lines[i])
        extra++
      } catch { /* skip */ }
    }
    validCount += extra
  }

  return { rowCount: validCount, preview, format: 'JSONL' }
}

function parseJSON(filePath: string): FileParseResult {
  const raw = fs.readFileSync(filePath, 'utf-8')
  try {
    const data = JSON.parse(raw)
    if (Array.isArray(data)) {
      return {
        rowCount: data.length,
        preview: data.slice(0, 10),
        format: 'JSON',
      }
    }
    // 单个对象 → 当作 1 行
    return { rowCount: 1, preview: [data], format: 'JSON' }
  } catch (e) {
    logger.warn('JSON file parse failed: ' + (e as Error).message)
    return { rowCount: 0, preview: [], format: 'JSON' }
  }
}

function parseText(filePath: string, format: string): FileParseResult {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim())
  return {
    rowCount: lines.length,
    preview: lines.slice(0, 10).map((l, i) => ({ line: i + 1, content: l.slice(0, 200) })),
    format,
  }
}
