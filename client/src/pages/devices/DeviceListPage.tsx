import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { devicesApi } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Search, Factory, Wrench, Activity, AlertTriangle, Plug, Download } from 'lucide-react'

const DEVICE_CATEGORIES = [
  { value: 'pump', label: '泵' },
  { value: 'motor', label: '电机' },
  { value: 'compressor', label: '压缩机' },
  { value: 'fan', label: '风机' },
  { value: 'conveyor', label: '传送带' },
  { value: 'valve', label: '阀门' },
  { value: 'transformer', label: '变压器' },
  { value: 'other', label: '其他' },
]

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  RUNNING: { label: '运行中', variant: 'default' },
  STOPPED: { label: '已停机', variant: 'secondary' },
  MAINTENANCE: { label: '维护中', variant: 'outline' },
  FAULT: { label: '故障', variant: 'destructive' },
}

export function DeviceListPage() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['devices', { page, keyword, status, category }],
    queryFn: () => devicesApi.list({ page, pageSize: 20, keyword, status, category }),
  })

  const { data: stats } = useQuery({
    queryKey: ['device-stats'],
    queryFn: () => devicesApi.stats(),
  })
  const statsData = stats as Record<string, number> | undefined

  const handleExport = () => {
    const token = sessionStorage.getItem('token')
    const baseUrl = import.meta.env.VITE_API_URL || '/api'
    const a = document.createElement('a')
    a.href = baseUrl + '/devices/export?token=' + encodeURIComponent(token || '')
    a.download = 'clmx-devices-export.csv'
    a.click()
  }

  const devices = data?.data || []
  const totalPages = data?.totalPages || 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">设备管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理设备台账、传感器配置和运行状态</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleExport} title="导出设备清单 CSV">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => navigate('/app/devices/quick-connect')}>
            <Plug className="h-4 w-4 mr-2" />快速接入
          </Button>
          <Button onClick={() => navigate('/app/devices/new')}>
            <Plus className="h-4 w-4 mr-2" />新增设备
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-primary/10"><Factory className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-sm text-muted-foreground">设备总数</p>
              <p className="text-xl font-semibold">{statsData?.total ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-green-500/10"><Activity className="h-5 w-5 text-green-600" /></div>
            <div>
              <p className="text-sm text-muted-foreground">运行中</p>
              <p className="text-xl font-semibold">{statsData?.running ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-amber-500/10"><Wrench className="h-5 w-5 text-amber-600" /></div>
            <div>
              <p className="text-sm text-muted-foreground">维护中</p>
              <p className="text-xl font-semibold">{statsData?.maintenance ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
            <div>
              <p className="text-sm text-muted-foreground">故障</p>
              <p className="text-xl font-semibold">{statsData?.fault ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索设备名称..." value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1) }} className="pl-9" />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-32"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="RUNNING">运行中</SelectItem>
            <SelectItem value="STOPPED">已停机</SelectItem>
            <SelectItem value="MAINTENANCE">维护中</SelectItem>
            <SelectItem value="FAULT">故障</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={v => { setCategory(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-32"><SelectValue placeholder="类别" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {DEVICE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 设备列表 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : devices.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Factory className="h-12 w-12 mb-3 opacity-30" />
          <p>暂无设备，点击"新增设备"开始管理</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {devices.map((device: any) => {
            const st = STATUS_MAP[device.status] || STATUS_MAP.RUNNING
            const healthScore = device.lastHealthScore
            const healthColor = healthScore === null || healthScore === undefined ? 'text-muted-foreground'
              : healthScore >= 80 ? 'text-green-600' : healthScore >= 60 ? 'text-amber-600' : 'text-red-600'
            return (
              <Card key={device.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/app/devices/${device.id}`)}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium">{device.name}</h3>
                      <p className="text-xs text-muted-foreground">{device.code} · {DEVICE_CATEGORIES.find(c => c.value === device.category)?.label || device.category}</p>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">健康评分</span>
                    <span className={`font-semibold ${healthColor}`}>
                      {healthScore !== null && healthScore !== undefined ? `${healthScore}分` : '未评估'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{device._count?.sensors || 0} 个传感器</span>
                    <span>{device._count?.maintenanceOrders || 0} 个工单</span>
                  </div>
                  {device.location && <p className="text-xs text-muted-foreground">📍 {device.location}</p>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
      )}
    </div>
  )
}
