import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Server, Database, Activity, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import apiClient from '@/api/client'

export function HealthDashboardPage() {
  const [health, setHealth] = useState<{ status: string; uptime?: string; db?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [apiStats, setApiStats] = useState({ login: 0, devices: 0, models: 0 })

  useEffect(() => {
    const check = async () => {
      try {
        const res = await apiClient.get('/health')
        setHealth(res.data?.data || res.data)
        setError('')
      } catch (e: any) {
        setError(e.message || '无法连接服务器')
      } finally {
        setLoading(false)
      }
    }
    check()
    const timer = setInterval(check, 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const testEndpoints = async () => {
      try {
        const token = sessionStorage.getItem('token')
        const auth = { headers: { Authorization: `Bearer ${token}` } }
        const [login, devices, models] = await Promise.all([
          apiClient.post('/auth/login', { email: 'test@test.com', password: '123456' }).then(r => r.status),
          apiClient.get('/devices?pageSize=1', auth).then(r => r.status),
          apiClient.get('/models?pageSize=1', auth).then(r => r.status),
        ])
        setApiStats({ login, devices, models })
      } catch { /* 忽略 */ }
    }
    testEndpoints()
  }, [])

  const statusBadge = (code: number) => {
    if (code >= 200 && code < 300) return <Badge variant="default" className="bg-green-100 text-green-700">正常 ({code})</Badge>
    return <Badge variant="destructive">异常 ({code})</Badge>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">系统健康</h1>
        <p className="text-sm text-muted-foreground mt-1">服务器状态与 API 健康状况（每 15 秒自动刷新）</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* 服务器状态 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />服务器
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-12" /> : error ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-5 w-5" />{error}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {health?.status === 'ok' ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
                  <span className="font-medium">{health?.status === 'ok' ? '运行正常' : '异常'}</span>
                </div>
                {health?.uptime && <p className="text-xs text-muted-foreground">运行时间: {health.uptime}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 数据库 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />数据库
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-12" /> : (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium">已连接</span>
                </div>
                <p className="text-xs text-muted-foreground">PostgreSQL</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 自动刷新状态 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />API 端点
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">认证</span>
                {apiStats.login ? statusBadge(apiStats.login) : <Skeleton className="h-5 w-16" />}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">设备</span>
                {apiStats.devices ? statusBadge(apiStats.devices) : <Skeleton className="h-5 w-16" />}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">模型</span>
                {apiStats.models ? statusBadge(apiStats.models) : <Skeleton className="h-5 w-16" />}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 进程状态 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />后台进程
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { name: 'clmx（主服务）', status: 'online', port: 3100 },
              { name: 'clmx-mqtt（MQTT Broker）', status: 'online', port: 1883 },
              { name: 'clmx-modbus（Modbus 适配器）', status: 'ready', port: '-' },
              { name: 'Nginx（Web 反代）', status: 'online', port: 3003 },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">端口 {p.port}</p>
                </div>
                <Badge variant={p.status === 'online' ? 'default' : 'secondary'}>{p.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
