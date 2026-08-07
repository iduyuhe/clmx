import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuthStore } from '@/stores/authStore'
import { roleSatisfies } from '@/lib/role'
import type { UserRole } from '@/lib/role'
import { ingestApi, devicesApi, type IngestSpecDTO, type IngestAssetDTO, type IngestPointDTO, type SelfTestDTO } from '@/api'
import { toast } from 'sonner'
import { Boxes, Sparkles, PlayCircle, CheckCircle2, XCircle, Upload, Plug, Cpu } from 'lucide-react'

function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    generated: 'bg-blue-100 text-blue-700',
    verified: 'bg-green-100 text-green-700',
    published: 'bg-purple-100 text-purple-700',
    deprecated: 'bg-red-100 text-red-700',
  }
  return <Badge className={map[status] || 'bg-gray-100 text-gray-700'}>{status}</Badge>
}

function CreateSpecForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState('http')
  const [sourceUrl, setSourceUrl] = useState('')
  const [description, setDescription] = useState('')
  const [rawSpec, setRawSpec] = useState('')
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => ingestApi.createSpec({ name, sourceType, sourceUrl, description, rawSpec }),
    onSuccess: () => { toast.success('接入需求已创建'); qc.invalidateQueries({ queryKey: ['ingest-specs'] }); onDone(); setName(''); setDescription(''); setRawSpec(''); setSourceUrl('') },
    onError: (e: any) => toast.error('创建失败：' + (e?.message || '')),
  })
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plug className="h-4 w-4" /> 新建接入需求（AI 原生生成器）</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">设备/接入名称 *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：空压机站房" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">数据源类型</label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP 轮询</SelectItem>
                <SelectItem value="mqtt">MQTT</SelectItem>
                <SelectItem value="opcua">OPC-UA</SelectItem>
                <SelectItem value="modbus">Modbus</SelectItem>
                <SelectItem value="csv">CSV/文件</SelectItem>
                <SelectItem value="manual">手动</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">对接地址（可选）</label>
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="如：http://10.0.0.5/api/telemetry" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">协议/设备描述（自然语言，自动提取测点）</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="如：该设备包含温度、压力、振动三个测点，温度单位℃..." />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">结构化点位 / 样本（可选，JSON：{`{points:[{name,unit}]}`} 或样本报文）</label>
          <Textarea value={rawSpec} onChange={(e) => setRawSpec(e.target.value)} rows={3} placeholder='{"points":[{"name":"温度","unit":"℃"},{"name":"压力","unit":"MPa"}]}' />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={() => mut.mutate()} disabled={!name || mut.isPending}>
          <Sparkles className="h-4 w-4 mr-1" /> 创建并准备生成
        </Button>
      </CardFooter>
    </Card>
  )
}

function AssetCard({ asset, canManage }: { asset: IngestAssetDTO; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const qc = useQueryClient()
  const points = parseJSON<IngestPointDTO[]>(asset.thingModel, [])
  const selfTest = parseJSON<SelfTestDTO | null>(asset.selfTestResult, null)

  const devices = useQuery({ queryKey: ['devices-mini'], queryFn: () => devicesApi.list({ pageSize: 100 }) })

  const genMut = useMutation({ mutationFn: () => ingestApi.selfTest(asset.id), onSuccess: () => { toast.success('自测完成'); qc.invalidateQueries({ queryKey: ['ingest-specs'] }) }, onError: (e: any) => toast.error('自测失败：' + (e?.message || '')) })
  const pubMut = useMutation({ mutationFn: () => ingestApi.publish(asset.id), onSuccess: () => { toast.success('已发布到资产市场'); qc.invalidateQueries({ queryKey: ['ingest-specs'] }); qc.invalidateQueries({ queryKey: ['ingest-market'] }) }, onError: (e: any) => toast.error('发布失败：' + (e?.message || '')) })
  const depMut = useMutation({ mutationFn: () => ingestApi.deprecate(asset.id), onSuccess: () => { toast.success('已下线'); qc.invalidateQueries({ queryKey: ['ingest-specs'] }); qc.invalidateQueries({ queryKey: ['ingest-market'] }) }, onError: (e: any) => toast.error('操作失败：' + (e?.message || '')) })
  const runMut = useMutation({ mutationFn: () => ingestApi.run(asset.id, { deviceId: deviceId || undefined }), onSuccess: (r) => toast.success(`驱动执行完成：提取 ${r.readings.length} 条，写入 ${r.written} 条`), onError: (e: any) => toast.error('执行失败：' + (e?.message || '')) })

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">资产 v{asset.version} <StatusBadge status={asset.status} /> {asset.published && <Badge className="bg-purple-100 text-purple-700 ml-1">市场</Badge>}</CardTitle>
          <span className="text-xs text-muted-foreground">复用 {asset.reuseCount} 次</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {points.map((p) => <Badge key={p.key} variant="outline">{p.name}{p.unit ? ` (${p.unit})` : ''}</Badge>)}
          {points.length === 0 && <span className="text-xs text-muted-foreground">暂无测点</span>}
        </div>
        {selfTest && (
          <div className={`text-xs rounded p-2 ${selfTest.passed ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {selfTest.passed ? <CheckCircle2 className="inline h-3 w-3 mr-1" /> : <XCircle className="inline h-3 w-3 mr-1" />}
            自测：期望 {selfTest.expectedCount} 个测点 / 产出 {selfTest.gotCount} 条读数
            {selfTest.missing.length > 0 && `，缺失 ${selfTest.missing.join(', ')}`}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>查看驱动</Button>
        <Button size="sm" variant="outline" onClick={() => genMut.mutate()} disabled={genMut.isPending}><PlayCircle className="h-3 w-3 mr-1" />重跑自测</Button>
        {canManage && !asset.published && <Button size="sm" onClick={() => pubMut.mutate()} disabled={pubMut.isPending}><Upload className="h-3 w-3 mr-1" />发布市场</Button>}
        {canManage && asset.published && <Button size="sm" variant="destructive" onClick={() => depMut.mutate()} disabled={depMut.isPending}>下线</Button>}
        <div className="flex items-center gap-1 ml-auto">
          <Select value={deviceId} onValueChange={setDeviceId}>
            <SelectTrigger className="h-8 w-40"><SelectValue placeholder="选择设备运行" /></SelectTrigger>
            <SelectContent>
              {(devices.data?.data || []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending}><PlayCircle className="h-3 w-3 mr-1" />运行</Button>
        </div>
      </CardFooter>
      {open && (
        <CardContent>
          <pre className="text-[11px] bg-muted p-2 rounded overflow-auto max-h-64">{asset.driverCode}</pre>
        </CardContent>
      )}
    </Card>
  )
}

function MySpecs() {
  const qc = useQueryClient()
  const role = (useAuthStore((s) => s.user)?.role || 'VIEWER') as UserRole
  const canManage = roleSatisfies(role, 'MANAGER')
  const [showForm, setShowForm] = useState(false)
  const specs = useQuery({ queryKey: ['ingest-specs'], queryFn: () => ingestApi.listSpecs() })
  const genMut = useMutation({ mutationFn: (id: string) => ingestApi.generate(id), onSuccess: (r) => { toast.success(`生成完成（来源：${r.from}），测点 ${r.points.length} 个`); qc.invalidateQueries({ queryKey: ['ingest-specs'] }) }, onError: (e: any) => toast.error('生成失败：' + (e?.message || '')) })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">提交设备描述/协议，由生成器自动产出物模型 + 零依赖采集驱动（运行时纯 JS，无 LLM）。</p>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plug className="h-4 w-4 mr-1" />{showForm ? '收起' : '新建接入'}</Button>
      </div>
      {showForm && <CreateSpecForm onDone={() => setShowForm(false)} />}
      {specs.isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {(specs.data || []).map((s: IngestSpecDTO) => (
        <Card key={s.id} className="mb-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Cpu className="h-4 w-4" />{s.name}</CardTitle>
              <StatusBadge status={s.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-muted-foreground">数据源：{s.sourceType}{s.sourceUrl ? ` · ${s.sourceUrl}` : ''}</p>
            {s.description && <p className="text-muted-foreground">描述：{s.description}</p>}
            <div className="pt-1">
              {s.assets && s.assets.length > 0 ? (
                s.assets.map((a) => <AssetCard key={a.id} asset={a} canManage={canManage} />)
              ) : (
                <p className="text-xs text-muted-foreground">尚未生成资产</p>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button size="sm" onClick={() => genMut.mutate(s.id)} disabled={genMut.isPending}>
              <Sparkles className="h-4 w-4 mr-1" /> AI 生成物模型 + 驱动
            </Button>
          </CardFooter>
        </Card>
      ))}
      {(specs.data || []).length === 0 && !showForm && <p className="text-sm text-muted-foreground">还没有接入需求，点「新建接入」开始。</p>}
    </div>
  )
}

function Marketplace() {
  const qc = useQueryClient()
  const role = (useAuthStore((s) => s.user)?.role || 'VIEWER') as UserRole
  const canManage = roleSatisfies(role, 'MANAGER')
  const [deviceId, setDeviceId] = useState('')
  const assets = useQuery({ queryKey: ['ingest-market'], queryFn: () => ingestApi.listAssets(true) })
  const devices = useQuery({ queryKey: ['devices-mini2'], queryFn: () => devicesApi.list({ pageSize: 100 }) })
  const applyMut = useMutation({ mutationFn: (assetId: string) => ingestApi.apply(assetId, deviceId), onSuccess: (r) => { toast.success(`已在目标设备自动创建 ${r.count} 个传感器`); qc.invalidateQueries({ queryKey: ['ingest-market'] }) }, onError: (e: any) => toast.error('复用失败：' + (e?.message || '')) })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">已验证的接入资产（跨租户复用）。一键应用到你的设备，自动生成传感器。</p>
        <Select value={deviceId} onValueChange={setDeviceId}>
          <SelectTrigger className="h-8 w-48"><SelectValue placeholder="选择目标设备" /></SelectTrigger>
          <SelectContent>
            {(devices.data?.data || []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {assets.isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {(assets.data || []).length === 0 && <p className="text-sm text-muted-foreground">资产市场暂无已发布资产。去「我的接入」生成并发布一个吧。</p>}
      {(assets.data || []).map((a: IngestAssetDTO) => {
        const points = parseJSON<IngestPointDTO[]>(a.thingModel, [])
        return (
          <Card key={a.id} className="mb-3">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{a.spec?.name || '资产'} <Badge variant="outline" className="ml-1">{a.spec?.sourceType}</Badge> <StatusBadge status={a.status} /></CardTitle>
                <span className="text-xs text-muted-foreground">复用 {a.reuseCount} 次</span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {points.map((p) => <Badge key={p.key} variant="outline">{p.name}{p.unit ? ` (${p.unit})` : ''}</Badge>)}
            </CardContent>
            <CardFooter>
              <Button size="sm" disabled={!deviceId || applyMut.isPending || !canManage} onClick={() => applyMut.mutate(a.id)}>
                <Boxes className="h-4 w-4 mr-1" /> 一键复用（建传感器）
              </Button>
              {!canManage && <span className="text-xs text-muted-foreground ml-2">需 MANAGER 权限</span>}
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}

export function IngestLibraryPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Boxes className="h-5 w-5" /> AI 原生接入生成器 · 能力资产市场</h1>
        <p className="text-sm text-muted-foreground mt-1">
          思想源自 HubPort：让「接入」也生成化（创建时 AI 生成、运行时零依赖），并把接入成果沉淀为可复用、可分发的能力资产。
        </p>
      </div>
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">我的接入</TabsTrigger>
          <TabsTrigger value="market">资产市场</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-4"><MySpecs /></TabsContent>
        <TabsContent value="market" className="mt-4"><Marketplace /></TabsContent>
      </Tabs>
    </div>
  )
}
