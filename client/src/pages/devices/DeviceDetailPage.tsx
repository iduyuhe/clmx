import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesApi, healthApi } from '@/api'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, Trash2, Activity, Calculator, Gauge } from 'lucide-react'

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  RUNNING: { label: '运行中', variant: 'default' },
  STOPPED: { label: '已停机', variant: 'secondary' },
  MAINTENANCE: { label: '维护中', variant: 'outline' },
  FAULT: { label: '故障', variant: 'destructive' },
}

const SENSOR_CHANNELS = [
  { value: 'vibration', label: '振动' },
  { value: 'temperature', label: '温度' },
  { value: 'pressure', label: '压力' },
  { value: 'current', label: '电流' },
  { value: 'voltage', label: '电压' },
  { value: 'rpm', label: '转速' },
  { value: 'flow', label: '流量' },
  { value: 'humidity', label: '湿度' },
  { value: 'other', label: '其他' },
]

export function DeviceDetailPage() {
  const { deviceId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showAddSensor, setShowAddSensor] = useState(false)
  const [sensorForm, setSensorForm] = useState({ name: '', channel: 'vibration', unit: '', samplingRate: 1, minThreshold: '', maxThreshold: '', autoBaseline: false })

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => devicesApi.get(deviceId!),
    enabled: !!deviceId,
  })

  const { data: healthHistory } = useQuery({
    queryKey: ['health-history', deviceId],
    queryFn: () => healthApi.history(deviceId!, 20),
    enabled: !!deviceId,
  })

  const addSensorMutation = useMutation({
    mutationFn: () => devicesApi.addSensor(deviceId!, {
      ...sensorForm,
      samplingRate: Number(sensorForm.samplingRate),
      minThreshold: sensorForm.minThreshold ? Number(sensorForm.minThreshold) : null,
      maxThreshold: sensorForm.maxThreshold ? Number(sensorForm.maxThreshold) : null,
      autoBaseline: sensorForm.autoBaseline,
    }),
    onSuccess: () => {
      toast.success('传感器添加成功')
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
      setShowAddSensor(false)
      setSensorForm({ name: '', channel: 'vibration', unit: '', samplingRate: 1, minThreshold: '', maxThreshold: '' })
    },
    onError: () => toast.error('添加失败'),
  })

  const deleteSensorMutation = useMutation({
    mutationFn: (sensorId: string) => devicesApi.removeSensor(deviceId!, sensorId),
    onSuccess: () => { toast.success('传感器已删除'); queryClient.invalidateQueries({ queryKey: ['device', deviceId] }) },
  })

  const calculateHealthMutation = useMutation({
    mutationFn: () => healthApi.calculate(deviceId!),
    onSuccess: (data: any) => {
      toast.success('健康评分已更新')
      const wo = data?.autoWorkOrder
      if (wo?.created) toast.success('已自动创建维修工单')
      else if (wo?.skipped) toast.info('近 1 小时已有未关闭工单，已防重复建单')
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['health-history', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['maintenance'] })
    },
    onError: () => toast.error('计算失败'),
  })

  const recomputeBaselineMutation = useMutation({
    mutationFn: (sensorId: string) => healthApi.recomputeBaseline(sensorId),
    onSuccess: () => { toast.success('基线已重新计算'); queryClient.invalidateQueries({ queryKey: ['device', deviceId] }) },
    onError: () => toast.error('计算失败'),
  })

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">加载中...</div>
  if (!device) return <div className="text-center py-12 text-muted-foreground">设备不存在</div>

  const d = device as any
  const st = STATUS_MAP[d.status] || STATUS_MAP.RUNNING
  const healthColor = d.lastHealthScore === null || d.lastHealthScore === undefined ? 'text-muted-foreground'
    : d.lastHealthScore >= 80 ? 'text-green-600' : d.lastHealthScore >= 60 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/devices')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{d.name}</h1>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{d.code} · {d.location || '未设置位置'}</p>
        </div>
        <Button onClick={() => calculateHealthMutation.mutate()} disabled={calculateHealthMutation.isPending}>
          <Calculator className="h-4 w-4 mr-2" />计算健康评分
        </Button>
      </div>

      {/* 健康评分 + 设备信息 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Activity className="h-8 w-8 mx-auto mb-2 text-primary" />
            <p className="text-sm text-muted-foreground">当前健康评分</p>
            <p className={`text-3xl font-bold ${healthColor}`}>
              {d.lastHealthScore !== null && d.lastHealthScore !== undefined ? d.lastHealthScore : '--'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-sm text-muted-foreground">设备信息</p>
            <div className="text-sm space-y-0.5">
              <p><span className="text-muted-foreground">制造商：</span>{d.manufacturer || '-'}</p>
              <p><span className="text-muted-foreground">型号：</span>{d.modelNumber || '-'}</p>
              <p><span className="text-muted-foreground">安装日期：</span>{d.installDate ? new Date(d.installDate).toLocaleDateString() : '-'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-sm text-muted-foreground">传感器 / 工单</p>
            <div className="text-sm space-y-0.5">
              <p><span className="text-muted-foreground">传感器数：</span>{d.sensors?.length || 0}</p>
              <p><span className="text-muted-foreground">待处理工单：</span>{d.maintenanceOrders?.filter((o: any) => o.status === 'PENDING' || o.status === 'IN_PROGRESS').length || 0}</p>
              <p><span className="text-muted-foreground">历史工单：</span>{d.maintenanceOrders?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 传感器管理 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">传感器配置</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowAddSensor(!showAddSensor)}>
              <Plus className="h-4 w-4 mr-1" />添加传感器
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showAddSensor && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">名称</Label>
                  <Input value={sensorForm.name} onChange={e => setSensorForm({ ...sensorForm, name: e.target.value })} placeholder="如：主轴承振动" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">通道类型</Label>
                  <select className="w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={sensorForm.channel} onChange={e => setSensorForm({ ...sensorForm, channel: e.target.value })}>
                    {SENSOR_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">单位</Label>
                  <Input value={sensorForm.unit} onChange={e => setSensorForm({ ...sensorForm, unit: e.target.value })} placeholder="如：mm/s" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">采样频率(Hz)</Label>
                  <Input type="number" value={sensorForm.samplingRate} onChange={e => setSensorForm({ ...sensorForm, samplingRate: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">阈值下限</Label>
                  <Input type="number" value={sensorForm.minThreshold} onChange={e => setSensorForm({ ...sensorForm, minThreshold: e.target.value })} placeholder="选填" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">阈值上限</Label>
                  <Input type="number" value={sensorForm.maxThreshold} onChange={e => setSensorForm({ ...sensorForm, maxThreshold: e.target.value })} placeholder="选填" disabled={sensorForm.autoBaseline} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={sensorForm.autoBaseline} onChange={e => setSensorForm({ ...sensorForm, autoBaseline: e.target.checked })} />
                自动基线：根据历史数据自动计算阈值（开启后忽略上面手动阈值）
              </label>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowAddSensor(false)}>取消</Button>
                <Button size="sm" onClick={() => addSensorMutation.mutate()} disabled={!sensorForm.name}>添加</Button>
              </div>
            </div>
          )}

          {d.sensors?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Gauge className="h-8 w-8 mx-auto mb-2 opacity-30" />
              暂无传感器，点击"添加传感器"开始配置
            </div>
          ) : (
            <div className="space-y-2">
              {d.sensors?.map((sensor: any) => (
                <div key={sensor.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{sensor.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {SENSOR_CHANNELS.find(c => c.value === sensor.channel)?.label || sensor.channel} · {sensor.unit || '无单位'} · {sensor.samplingRate}Hz
                        {sensor.autoBaseline
                          ? (sensor.baselineMin != null && sensor.baselineMax != null ? ` · 自动基线[${Number(sensor.baselineMin).toFixed(2)}, ${Number(sensor.baselineMax).toFixed(2)}]` : ' · 自动基线(未计算)')
                          : (sensor.minThreshold != null && sensor.maxThreshold != null && ` · 阈值[${sensor.minThreshold}, ${sensor.maxThreshold}]`)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={sensor.status === 'ACTIVE' ? 'default' : 'secondary'}>
                      {sensor.status === 'ACTIVE' ? '启用' : '禁用'}
                    </Badge>
                    {sensor.autoBaseline && (
                      <Button size="sm" variant="outline" disabled={recomputeBaselineMutation.isPending} onClick={() => recomputeBaselineMutation.mutate(sensor.id)}>
                        计算基线
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => deleteSensorMutation.mutate(sensor.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 健康评分历史 */}
      {healthHistory && Array.isArray(healthHistory) && healthHistory.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">健康评分历史</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {healthHistory.slice(-30).map((score: any, i: number) => {
                const color = score.score >= 80 ? 'bg-green-500' : score.score >= 60 ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className={`w-full ${color} rounded-t`} style={{ height: `${score.score}%` }} />
                    <div className="absolute -top-6 opacity-0 group-hover:opacity-100 text-xs bg-card border rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                      {score.score} · {new Date(score.createdAt).toLocaleString()}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 维修工单 */}
      {d.maintenanceOrders && d.maintenanceOrders.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">维修工单</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.maintenanceOrders.map((order: any) => (
              <div key={order.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">{order.title}</p>
                  <p className="text-xs text-muted-foreground">{order.type} · {order.priority} · {new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <Badge variant={order.status === 'COMPLETED' ? 'default' : order.status === 'PENDING' ? 'secondary' : 'outline'}>
                  {order.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
