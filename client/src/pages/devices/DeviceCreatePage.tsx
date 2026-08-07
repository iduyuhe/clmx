import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '@/api'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft } from 'lucide-react'

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

export function DeviceCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: '', code: '', category: 'other', manufacturer: '', modelNumber: '',
    location: '', installDate: '', description: '',
  })

  const createMutation = useMutation({
    mutationFn: () => devicesApi.create(form),
    onSuccess: (data: any) => {
      toast.success('设备创建成功')
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['device-stats'] })
      navigate(`/app/devices/${data.id}`)
    },
    onError: () => toast.error('创建失败'),
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/devices')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">新增设备</h1>
          <p className="text-sm text-muted-foreground mt-1">录入设备台账信息</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">基本信息</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>设备名称 <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：1号冷却水泵" />
            </div>
            <div className="space-y-2">
              <Label>设备编码 <span className="text-red-500">*</span></Label>
              <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="如：PUMP-001" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>设备类别</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEVICE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>安装日期</Label>
              <Input type="date" value={form.installDate} onChange={e => setForm({ ...form, installDate: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>制造商</Label>
              <Input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="如：ABB" />
            </div>
            <div className="space-y-2">
              <Label>型号</Label>
              <Input value={form.modelNumber} onChange={e => setForm({ ...form, modelNumber: e.target.value })} placeholder="如：ACS-580" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>安装位置</Label>
            <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="如：A厂区-1号车间-B区" />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="设备补充说明..." />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/app/devices')}>取消</Button>
        <Button onClick={() => createMutation.mutate()} disabled={!form.name || !form.code || createMutation.isPending}>
          {createMutation.isPending ? '创建中...' : '创建设备'}
        </Button>
      </div>
    </div>
  )
}
