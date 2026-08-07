export function formatFileSize(bytes: number | undefined | null): string {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    QUEUED: '排队中', RUNNING: '训练中', PAUSED: '已暂停',
    COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消',
    DRAFT: '草稿', TRAINING: '训练中', TRAINED: '已训练',
    DEPLOYED: '已部署', ARCHIVED: '已归档',
    UPLOADING: '上传中', PROCESSING: '处理中', READY: '就绪', ERROR: '错误',
    DEPLOYING: '部署中', STOPPED: '已停止',
  }
  return map[status] || status
}
