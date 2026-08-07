import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { demoApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Trash2, Loader2 } from 'lucide-react'

type Scale = 'small' | 'medium' | 'large'
interface GenResult {
  devices: number
  sensors: number
  sensorDataPoints: number
  healthScores: number
  alertRules: number
  maintenanceOrders: number
  scale: string
}

const SCALE_LABELS: Record<Scale, string> = {
  small: '轻量（3 设备 / 14 天）',
  medium: '标准（5 设备 / 30 天）',
  large: '完整（8 设备 / 60 天）',
}

export function DemoDataTab() {
  const qc = useQueryClient()
  const [scale, setScale] = useState<Scale>('medium')
  const [lastResult, setLastResult] = useState<GenResult | null>(null)

  const genMut = useMutation({
    mutationFn: () => demoApi.generate(scale),
    onSuccess: (data) => {
      setLastResult(data.data)
      toast.success('演示数据已生成')
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['health'] })
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '生成失败')),
  })

  const clearMut = useMutation({
    mutationFn: () => demoApi.clear(),
    onSuccess: () => {
      setLastResult(null)
      toast.success('演示数据已清空')
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['health'] })
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '清空失败')),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />演示数据生成器
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          一键为本租户灌入仿真工业设备、时序遥测、健康分、维护工单与告警规则，便于演示与讲解。
          所有演示数据以 <code className="px-1 rounded bg-muted">DEMO-</code> 标记，清空时仅删除演示数据，不影响你的真实数据。
        </p>

        <div className="grid gap-2 sm:max-w-md">
          <label className="text-sm font-medium">规模</label>
          <Select value={scale} onValueChange={(v) => setScale(v as Scale)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="small">{SCALE_LABELS.small}</SelectItem>
              <SelectItem value="medium">{SCALE_LABELS.medium}</SelectItem>
              <SelectItem value="large">{SCALE_LABELS.large}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => genMut.mutate()} disabled={genMut.isPending}>
            {genMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {genMut.isPending ? '生成中...' : '生成演示数据'}
          </Button>
          <Button variant="outline" onClick={() => { if (window.confirm('确定清空所有演示数据（仅 DEMO- 标记）吗？')) clearMut.mutate() }} disabled={clearMut.isPending}>
            {clearMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {clearMut.isPending ? '清空中...' : '清空演示数据'}
          </Button>
        </div>

        {lastResult && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">本次生成概览</span>
              <Badge variant="secondary">{SCALE_LABELS[lastResult.scale as Scale]?.split('（')[0] || lastResult.scale}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="设备" value={lastResult.devices} />
              <Stat label="传感器" value={lastResult.sensors} />
              <Stat label="遥测数据点" value={lastResult.sensorDataPoints} />
              <Stat label="健康分记录" value={lastResult.healthScores} />
              <Stat label="告警规则" value={lastResult.alertRules} />
              <Stat label="维护工单" value={lastResult.maintenanceOrders} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-0.5">{value.toLocaleString()}</p>
    </div>
  )
}
