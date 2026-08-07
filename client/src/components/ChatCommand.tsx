import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { nlCommandApi } from '@/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, Send, X, ArrowUpRight } from 'lucide-react'

interface NlMsg {
  role: 'user' | 'bot'
  text: string
  action?: string
  data?: unknown
}

type SuggestionMap = Record<string, string[]>

const DEFAULT_SUGGESTIONS = ['整体概览', '设备有哪些', '健康分最低的是哪台', '最近有哪些异常', '待处理工单', '有哪些模型']

// 根据上一轮 action 给出上下文相关建议
const CONTEXT_SUGGESTIONS: SuggestionMap = {
  dashboard: ['设备有哪些', '最近有哪些异常', '待处理工单'],
  'device-list': ['健康分最低的是哪台', '整体概览', '查设备健康'],
  'worst-device': ['给该设备建工单', '计算该设备健康分', '查该设备最新读数'],
  'device-health': ['查最新读数', '计算该设备健康分', '给该设备建工单'],
  'latest-reading': ['计算该设备健康分', '给该设备建工单'],
  anomaly: ['待处理工单', '整体概览'],
  orders: ['建工单', '整体概览'],
  training: ['有哪些模型', '整体概览'],
  models: ['训练任务进度', '整体概览'],
  notifications: ['待处理工单', '整体概览'],
  'recalc-all': ['待处理工单', '整体概览'],
  'create-ticket': ['待处理工单', '整体概览'],
  calculate: ['查最新读数', '给该设备建工单'],
}

function scoreBadge(score: number | null | undefined): { text: string; cls: string } {
  if (score == null) return { text: '暂无', cls: 'bg-slate-100 text-slate-600' }
  if (score >= 80) return { text: `健康 ${score}`, cls: 'bg-emerald-100 text-emerald-700' }
  if (score >= 60) return { text: `预警 ${score}`, cls: 'bg-amber-100 text-amber-700' }
  return { text: `危险 ${score}`, cls: 'bg-red-100 text-red-700' }
}

function StructuredResult({ action, data }: { action?: string; data?: unknown }) {
  const nav = useNavigate()
  if (!action || data == null) return null

  const goDevice = (id?: string) => id && nav(`/app/devices/${id}`)
  const goMaintenance = () => nav('/app/maintenance')
  const goTraining = () => nav('/app/training')
  const goModels = () => nav('/app/models')

  if (action === 'dashboard') {
    const d = data as { devices: number; healthy: number; anomaly: number; openOrders: number; trainings: number; models: number; unread: number }
    const stats = [
      { label: '设备', value: d.devices, sub: `健康${d.healthy}/异常${d.anomaly}` },
      { label: '待处理工单', value: d.openOrders, sub: '需跟进' },
      { label: '未读通知', value: d.unread, sub: '条' },
      { label: '训练中', value: d.trainings, sub: '任务' },
      { label: '模型', value: d.models, sub: '个' },
    ]
    return (
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md bg-muted/60 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
            <div className="text-base font-semibold leading-tight">{s.value}</div>
            <div className="text-[10px] text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>
    )
  }

  if (action === 'device-list' || action === 'device-health-list') {
    const list = data as Array<{ id: string; name: string; code?: string | null; lastHealthScore: number | null }>
    return (
      <div className="mt-1 space-y-1">
        {list.map((d) => {
          const b = scoreBadge(d.lastHealthScore)
          return (
            <button
              key={d.id}
              onClick={() => goDevice(d.id)}
              className="flex w-full items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="truncate">{d.name}{d.code ? `（${d.code}）` : ''}</span>
              <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${b.cls}`}>{b.text}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (action === 'worst-device' || action === 'device-health') {
    const d = data as { id?: string; name: string; code?: string | null; lastHealthScore: number | null }
    const b = scoreBadge(d.lastHealthScore)
    return (
      <div className="mt-1 flex items-center justify-between rounded-md bg-muted/60 px-2 py-2">
        <div>
          <div className="text-sm font-medium">{d.name}{d.code ? `（${d.code}）` : ''}</div>
          <div className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${b.cls}`}>{b.text}</div>
        </div>
        {d.id && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => goDevice(d.id)}>
            查看 <ArrowUpRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    )
  }

  if (action === 'latest-reading') {
    const d = data as { deviceName: string; sensors: Array<{ id: string; name: string; unit?: string | null; value: number | null }> }
    return (
      <div className="mt-1 space-y-1">
        {d.sensors.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-xs">
            <span className="truncate">{s.name}</span>
            <span className="ml-2 shrink-0 font-medium">{s.value ?? '—'}{s.unit || ''}</span>
          </div>
        ))}
      </div>
    )
  }

  if (action === 'anomaly') {
    const d = data as { bad: Array<{ name: string; lastHealthScore: number | null }>; openOrders: number }
    return (
      <div className="mt-1 space-y-1">
        {d.bad.map((b) => {
          const sb = scoreBadge(b.lastHealthScore)
          return (
            <div key={b.name} className="flex items-center justify-between rounded-md bg-red-50 px-2 py-1.5 text-xs">
              <span className="truncate">{b.name}</span>
              <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${sb.cls}`}>{sb.text}</span>
            </div>
          )
        })}
        {d.bad.length === 0 && <div className="text-xs text-muted-foreground">无设备低于阈值。</div>}
      </div>
    )
  }

  if (action === 'orders') {
    const list = data as Array<{ id: string; title: string; status: string; device?: { name?: string } }>
    return (
      <div className="mt-1 space-y-1">
        {list.map((o) => (
          <button
            key={o.id}
            onClick={goMaintenance}
            className="flex w-full items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-left text-xs hover:bg-accent"
          >
            <span className="truncate">[{o.status}] {o.title}</span>
            <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        ))}
        <Button size="sm" variant="outline" className="mt-1 h-7 w-full text-xs" onClick={goMaintenance}>前往工单页</Button>
      </div>
    )
  }

  if (action === 'training') {
    const list = data as Array<{ id: string; status: string; progress: number; model?: { name?: string } }>
    return (
      <div className="mt-1 space-y-1">
        {list.map((j) => (
          <div key={j.id} className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="truncate">{j.model?.name || '-'}</span>
              <span className="shrink-0 text-muted-foreground">{j.status}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-200">
              <div className="h-full bg-primary" style={{ width: `${j.progress}%` }} />
            </div>
          </div>
        ))}
        <Button size="sm" variant="outline" className="mt-1 h-7 w-full text-xs" onClick={goTraining}>前往训练页</Button>
      </div>
    )
  }

  if (action === 'models') {
    const list = data as Array<{ id: string; name: string; baseModel?: string | null; status: string }>
    return (
      <div className="mt-1 space-y-1">
        {list.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-xs">
            <span className="truncate">{m.name}</span>
            <span className="shrink-0 text-muted-foreground">{m.status}</span>
          </div>
        ))}
        <Button size="sm" variant="outline" className="mt-1 h-7 w-full text-xs" onClick={goModels}>前往模型页</Button>
      </div>
    )
  }

  if (action === 'notifications') {
    const list = data as Array<{ id: string; title: string; body: string; read: boolean }>
    return (
      <div className="mt-1 space-y-1">
        {list.map((n) => (
          <div key={n.id} className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
            <div className="flex items-center gap-1">
              {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
              <span className="truncate font-medium">{n.title}</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{n.body.slice(0, 50)}</div>
          </div>
        ))}
      </div>
    )
  }

  if (action === 'recalc-all' || action === 'create-ticket' || action === 'calculate') {
    if (action === 'recalc-all') {
      const d = data as { total: number; created: number; skipped: number; ok: number }
      return (
        <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-md bg-muted/60 px-1 py-1.5"><div className="text-sm font-semibold">{d.created}</div><div className="text-[10px] text-muted-foreground">新建工单</div></div>
          <div className="rounded-md bg-muted/60 px-1 py-1.5"><div className="text-sm font-semibold">{d.skipped}</div><div className="text-[10px] text-muted-foreground">防重复</div></div>
          <div className="rounded-md bg-muted/60 px-1 py-1.5"><div className="text-sm font-semibold">{d.ok}</div><div className="text-[10px] text-muted-foreground">无异常</div></div>
        </div>
      )
    }
    if (action === 'create-ticket') {
      const d = data as { orderId: string; title: string; deviceName: string }
      return (
        <div className="mt-1 flex items-center justify-between rounded-md bg-emerald-50 px-2 py-2">
          <div className="text-xs">{d.title}</div>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={goMaintenance}>查看 <ArrowUpRight className="h-3 w-3" /></Button>
        </div>
      )
    }
  }

  return null
}

export function ChatCommand() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<NlMsg[]>([
    { role: 'bot', text: '你好，我是 CLMX 智能助手。用自然语言就能查设备健康、异常、工单、训练状态，还能触发重算与建单。试试下面的建议。' },
  ])
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, open])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setInput('')
    setLoading(true)
    try {
      const res = await nlCommandApi.send(q)
      setMsgs((m) => [...m, { role: 'bot', text: res.reply, action: res.action, data: res.data }])
      if (res.action && CONTEXT_SUGGESTIONS[res.action]) {
        setSuggestions(CONTEXT_SUGGESTIONS[res.action])
      } else {
        setSuggestions(DEFAULT_SUGGESTIONS)
      }
    } catch {
      toast.error('指令处理失败')
      setMsgs((m) => [...m, { role: 'bot', text: '抱歉，处理失败，请稍后再试。' }])
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform"
        title="智能助手"
      >
        <MessageSquare className="h-5 w-5" />
      </button>
    )
  }

  return (
    <Card className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-80 flex-col shadow-2xl sm:w-96">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />CLMX 智能助手
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <ScrollArea className="flex-1 px-3 py-2" ref={scrollRef as never}>
        <div className="space-y-2">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] ${m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
                <div
                  className={`max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  }`}
                >
                  {m.text}
                </div>
                {m.role === 'bot' && m.action && <StructuredResult action={m.action} data={m.data} />}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t px-3 py-2">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="说句话，比如：整体概览 / 给电机A建工单"
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Card>
  )
}
