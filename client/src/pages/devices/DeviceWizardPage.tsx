import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { devicesApi, opcuaApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plug, CheckCircle2, Loader2, Wifi, Radio, Cable, Link2 } from 'lucide-react'

const PROTOCOLS = [
  {
    id: 'mqtt',
    label: 'MQTT',
    icon: Wifi,
    desc: '物联网网关 / PLC 上云 / 边缘采集',
    endpointExample: '43.153.172.52:1883',
    docsLink: 'docs/设备接入对接文档.md#二mqtt-接入',
  },
  {
    id: 'http',
    label: 'HTTP 推送',
    icon: Radio,
    desc: '边缘盒子 / SCADA REST 上报 / 第三方对接',
    endpointExample: 'https://<host>/api/ingest/telemetry',
    docsLink: 'docs/设备接入对接文档.md#四http-推送接入',
  },
  {
    id: 'opcua',
    label: 'OPC-UA',
    icon: Cable,
    desc: '工厂 SCADA / MES / 传统 OPC 服务器',
    endpointExample: 'opc.tcp://your-server:4840',
    docsLink: 'docs/设备接入对接文档.md#三opc-ua-接入',
  },
  {
    id: 'modbus',
    label: 'Modbus',
    icon: Link2,
    desc: 'PLC / 传感器 / 仪表 / 变频器',
    endpointExample: 'modbus://192.168.1.100:502',
    docsLink: 'docs/设备接入对接文档.md#五modbus-接入新增',
  },
]

type Step = 'protocol' | 'setup' | 'verify'

export function DeviceWizardPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('protocol')
  const [protocol, setProtocol] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [deviceCode, setDeviceCode] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle')

  const createDevice = useMutation({
    mutationFn: () => devicesApi.create({
      name: deviceName,
      code: deviceCode || deviceName.toLowerCase().replace(/\s+/g, '-'),
      category: 'generic',
      manufacturer: '',
      modelNumber: '',
      location: '',
      status: 'RUNNING',
    }),
    onSuccess: () => {
      toast.success('设备创建成功！接下来添加传感器...')
      navigate('/app/devices')
    },
    onError: () => toast.error('设备创建失败'),
  })

  const testConnection = async () => {
    setVerifyStatus('testing')
    try {
      if (protocol === 'opcua') {
        await opcuaApi.connect({ endpoint, intervalMs: 3000, mappings: [] })
        await opcuaApi.disconnect()
      } else {
        // MQTT/HTTP/Modbus: 简单健康检查
        const resp = await fetch(endpoint.startsWith('http') ? endpoint : `http://${endpoint}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        })
        if (!resp.ok && resp.status !== 0) throw new Error(`状态码: ${resp.status}`)
      }
      setVerifyStatus('pass')
      toast.success('连接验证通过')
    } catch (e: any) {
      setVerifyStatus('fail')
      toast.error(`连接失败: ${e.message}`)
    }
  }

  const selectedProtocol = PROTOCOLS.find(p => p.id === protocol)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/devices')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">快速接入设备</h1>
          <p className="text-sm text-muted-foreground mt-1">三步完成设备连接，开始采集数据</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {(['protocol', 'setup', 'verify'] as Step[]).map((s, i) => {
          const labels = { protocol: '选择协议', setup: '配置设备', verify: '验证连通' }
          const isActive = step === s
          const isDone = ['protocol', 'setup', 'verify'].indexOf(step) > i
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${
                isActive ? 'bg-primary text-primary-foreground' : isDone ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
              }`}>
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="w-3.5 text-center text-xs">{i + 1}</span>}
                {labels[s]}
              </div>
              {i < 2 && <div className="h-px w-8 bg-border" />}
            </div>
          )
        })}
      </div>

      {step === 'protocol' && (
        <Card>
          <CardHeader><CardTitle className="text-base">选择设备接入协议</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {PROTOCOLS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProtocol(p.id); setEndpoint(p.endpointExample) }}
                  className={`flex items-start gap-4 p-4 rounded-lg border text-left transition ${
                    protocol === p.id ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:border-primary/50'
                  }`}
                >
                  <p.icon className={`h-6 w-6 mt-0.5 ${protocol === p.id ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground">{p.desc}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">示例端点: {p.endpointExample}</p>
                  </div>
                  {protocol === p.id && <Badge>已选</Badge>}
                </button>
              ))}
            </div>
            <Button className="w-full mt-4" onClick={() => setStep('setup')} disabled={!protocol}>
              下一步：配置设备
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'setup' && selectedProtocol && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><selectedProtocol.icon className="h-5 w-5" />配置 {selectedProtocol.label} 设备</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>设备名称</Label>
              <Input value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder="例如：1# 主风机" />
            </div>
            <div className="grid gap-2">
              <Label>设备编码</Label>
              <Input value={deviceCode} onChange={e => setDeviceCode(e.target.value)} placeholder="唯一标识，如 FAN-001（留空自动生成）" />
            </div>
            <div className="grid gap-2">
              <Label>服务端点</Label>
              <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder={selectedProtocol.endpointExample} />
              <p className="text-xs text-muted-foreground">
                {selectedProtocol.label} 接入说明：<a href={selectedProtocol.docsLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">查看文档</a>
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('protocol')}>上一步</Button>
              <Button className="flex-1" onClick={() => setStep('verify')} disabled={!deviceName}>
                下一步：验证连通
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'verify' && selectedProtocol && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" />验证连通性</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">设备</span><span className="font-medium">{deviceName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">协议</span><span className="font-medium">{selectedProtocol.label}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">端点</span><span className="font-medium">{endpoint}</span></div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={testConnection} disabled={verifyStatus === 'testing'}>
                {verifyStatus === 'testing' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}
                {verifyStatus === 'testing' ? '测试中...' : '测试连接'}
              </Button>
              {verifyStatus === 'pass' && <Badge variant="default" className="bg-green-100 text-green-700 border-green-200">连接成功</Badge>}
              {verifyStatus === 'fail' && <Badge variant="destructive">连接失败</Badge>}
            </div>
            {verifyStatus === 'pass' && (
              <div className="rounded-lg bg-green-50 p-4 space-y-3">
                <p className="text-sm text-green-700">连接验证通过！接下来：</p>
                <ol className="text-sm text-green-700 space-y-1 list-decimal list-inside">
                  <li>设备已就绪，点击下方完成创建</li>
                  <li>前往「设备详情」为设备添加传感器</li>
                  <li>配置传感器与 {selectedProtocol.label} 采集映射</li>
                </ol>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep('setup')}>上一步</Button>
              <Button className="flex-1" onClick={() => createDevice.mutate()} disabled={createDevice.isPending || verifyStatus !== 'pass'}>
                {createDevice.isPending ? '创建中...' : '完成，创建设备'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
