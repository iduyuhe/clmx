import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { maintenanceApi, devicesApi } from '@/api'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Plus, Wrench } from 'lucide-react'

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING: { label: '待处理', variant: 'secondary' },
  ASSIGNED: { label: '已分配', variant: 'outline' },
  IN_PROGRESS: { label: '处理中', variant: 'default' },
  COMPLETED: { label: '已完成', variant: 'default' },
  CANCELLED: { label: '已取消', variant: 'secondary' },
}

const PRIORITY_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  LOW: { label: '低', variant: 'secondary' },
  MEDIUM: { label: '中', variant: 'outline' },
  HIGH: { label: '高', variant: 'default' },
  CRITICAL: { label: '紧急', variant: 'destructive' },
}

const TYPE_MAP: Record<string, string> = {
  PREVENTIVE: '预防性维修',
  CORRECTIVE: '纠正性维修',
  INSPECTION: '巡检',
}

export function MaintenanceListPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ deviceId: '', type: 'PREVENTIVE', priority: 'MEDIUM', title: '', description: '', dueDate: '' })

  const { data } = useQuery({
    queryKey: ['maintenance', { page, status }],
    queryFn: () => maintenanceApi.list({ page, pageSize: 20, status }),
  })

  const { data: devicesData } = useQuery({
    queryKey: ['devices-all'],
    queryFn: () => devicesApi.list({ page: 1, pageSize: 100 }),
  })

  const createMutation = useMutation({
    mutationFn: () => maintenanceApi.create({ ...form, dueDate: form.dueDate || undefined }),
    onSuccess: () => {
      toast.success('工单创建成功')
      queryClient.invalidateQueries({ queryKey: ['maintenance'] })
      setShowCreate(false)
      setForm({ deviceId: '', type: 'PREVENTIVE', priority: 'MEDIUM', title: '', description: '', dueDate: '' })
    },
    onError: () => toast.error('创建失败'),
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => maintenanceApi.update(id, { status }),
    onSuccess: () => { toast.success('状态已更新'); queryClient.invalidateQueries({ queryKey: ['maintenance'] }) },
  })

  const orders = data?.data || []
  const totalPages = data?.totalPages || 1
  const devices = devicesData?.data || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">维修工单</h1>
          <p className="text-sm text-muted-foreground mt-1">管理设备维修工单和保养计划</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-2" />新建工单
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">新建维修工单</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>关联设备 <span className="text-red-500">*</span></Label>
                <Select value={form.deviceId} onValueChange={v => setForm({ ...form, deviceId: v })}>
                  <SelectTrigger><SelectValue placeholder="选择设备" /></SelectTrigger>
                  <SelectContent>
                    {devices.map((dev: any) => <SelectItem key={dev.id} value={dev.id}>{dev.name} ({dev.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>工单类型</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PREVENTIVE">预防性维修</SelectItem>
                    <SelectItem value="CORRECTIVE">纠正性维修</SelectItem>
                    <SelectItem value="INSPECTION">巡检</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>优先级</Label>
                <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">低</SelectItem>
                    <SelectItem value="MEDIUM">中</SelectItem>
                    <SelectItem value="HIGH">高</SelectItem>
                    <SelectItem value="CRITICAL">紧急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>截止日期</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>工单标题 <span className="text-red-500">*</span></Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="如：1号泵轴承更换" />
            </div>
            <div className="space-y-2">
              <Label>工单描述</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="维修内容、注意事项..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
              <Button onClick={() => createMutation.mutate()} disabled={!form.deviceId || !form.title || createMutation.isPending}>
                {createMutation.isPending ? '创建中...' : '创建工单'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 筛选 */}
      <div className="flex items-center gap-3">
        <Select value={status} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="PENDING">待处理</SelectItem>
            <SelectItem value="IN_PROGRESS">处理中</SelectItem>
            <SelectItem value="COMPLETED">已完成</SelectItem>
            <SelectItem value="CANCELLED">已取消</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 工单列表 */}
      {orders.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Wrench className="h-12 w-12 mb-3 opacity-30" />
          <p>暂无维修工单</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {orders.map((order: any) => {
            const st = STATUS_MAP[order.status] || STATUS_MAP.PENDING
            const pr = PRIORITY_MAP[order.priority] || PRIORITY_MAP.MEDIUM
            return (
              <Card key={order.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium">{order.title}</h3>
                        <Badge variant={pr.variant}>{pr.label}</Badge>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {order.device?.name} ({order.device?.code}) · {TYPE_MAP[order.type] || order.type} · {new Date(order.createdAt).toLocaleString()}
                        {order.dueDate && ` · 截止：${new Date(order.dueDate).toLocaleDateString()}`}
                      </p>
                      {order.description && <p className="text-sm text-muted-foreground mt-1">{order.description}</p>}
                    </div>
                    {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                      <div className="flex gap-1">
                        {order.status === 'PENDING' && (
                          <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate({ id: order.id, status: 'IN_PROGRESS' })}>开始处理</Button>
                        )}
                        {order.status === 'IN_PROGRESS' && (
                          <Button size="sm" onClick={() => updateStatusMutation.mutate({ id: order.id, status: 'COMPLETED' })}>完成</Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

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
