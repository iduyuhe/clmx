import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi, notificationApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import type { AlertChannel } from '@/types/models'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { BellRing, Plus, Pencil, Trash2 } from 'lucide-react'
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'

const CHANNEL_LABELS: Record<string, string> = { WEBHOOK: 'Webhook', WECHAT: '企微机器人', EMAIL: '邮件(预留)' }
const CREATEABLE_TYPES = ['WEBHOOK', 'WECHAT', 'EMAIL'] as const

export function AlertChannelsTab() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({ queryKey: ['settings', 'channels'], queryFn: () => settingsApi.getChannels() })
  const channels: AlertChannel[] = data?.data || []

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AlertChannel | null>(null)
  const [type, setType] = useState<(typeof CREATEABLE_TYPES)[number]>('WEBHOOK')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [enabled, setEnabled] = useState(true)

  const resetForm = () => { setType('WEBHOOK'); setName(''); setUrl(''); setEnabled(true); setEditing(null) }

  const saveMut = useMutation({
    mutationFn: () => {
      const config = type === 'EMAIL' ? {} : { url }
      const payload = { type, name, config, enabled }
      return editing ? settingsApi.updateChannel(editing.id, payload) : settingsApi.createChannel(payload)
    },
    onSuccess: () => { toast.success(editing ? '通道已更新' : '通道已添加'); setOpen(false); resetForm(); qc.invalidateQueries({ queryKey: ['settings', 'channels'] }) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '保存失败')),
  })

  const delMut = useMutation({
    mutationFn: (id: string) => settingsApi.deleteChannel(id),
    onSuccess: () => { toast.success('通道已删除'); qc.invalidateQueries({ queryKey: ['settings', 'channels'] }) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '删除失败')),
  })

  const toggleMut = useMutation({
    mutationFn: (ch: AlertChannel) => settingsApi.updateChannel(ch.id, { enabled: !ch.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'channels'] }),
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '操作失败')),
  })

  const testMut = useMutation({
    mutationFn: () => notificationApi.sendTest(),
    onSuccess: () => toast.success('测试告警已触发，请查收站内信与外部通道'),
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '发送失败')),
  })

  const openCreate = () => { resetForm(); setOpen(true) }
  const openEdit = (ch: AlertChannel) => {
    setEditing(ch)
    setType((['WEBHOOK', 'WECHAT', 'EMAIL'].includes(ch.type) ? ch.type : 'WEBHOOK') as typeof type)
    setName(ch.name); setEnabled(ch.enabled)
    try { setUrl(JSON.parse(ch.config || '{}').url || '') } catch { setUrl('') }
    setOpen(true)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5 text-muted-foreground" />告警投递通道</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => testMut.mutate()} disabled={testMut.isPending}>发送测试告警</Button>
            <Button size="sm" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />新增通道</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            站内信（In-App）默认开启，设备健康预警会自动推送给本租户所有成员。下方配置外部通道（Webhook / 企微群机器人）后，告警将同步投递到对应地址。
          </p>
          {isLoading ? <Skeleton className="h-32" /> : isError ? (
            <Empty><EmptyMedia><BellRing className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyTitle>加载失败</EmptyTitle><EmptyDescription>无法加载通道，请刷新重试</EmptyDescription></Empty>
          ) : channels.length === 0 ? (
            <Empty><EmptyMedia><BellRing className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyTitle>暂无外部通道</EmptyTitle><EmptyDescription>添加 Webhook 或企微机器人，让告警直达你的运维系统</EmptyDescription></Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((ch) => {
                  const cfg = (() => { try { return JSON.parse(ch.config || '{}') } catch { return {} } })()
                  return (
                    <TableRow key={ch.id}>
                      <TableCell><Badge variant="secondary">{CHANNEL_LABELS[ch.type] || ch.type}</Badge></TableCell>
                      <TableCell className="font-medium">{ch.name}</TableCell>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{ch.type === 'EMAIL' ? '（预留适配器）' : (cfg.url || '-')}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => toggleMut.mutate(ch)} disabled={toggleMut.isPending}>
                          {ch.enabled ? <Badge>已启用</Badge> : <Badge variant="outline">已停用</Badge>}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(ch)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => delMut.mutate(ch.id)} disabled={delMut.isPending}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? '编辑通道' : '新增告警通道'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1">
              <Label>通道类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)} disabled={!!editing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREATEABLE_TYPES.map((t) => <SelectItem key={t} value={t}>{CHANNEL_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>通道名称 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：运维钉钉/企微群" />
            </div>
            {type !== 'EMAIL' && (
              <div className="grid gap-1">
                <Label>{type === 'WECHAT' ? '企微机器人 Webhook 地址' : '回调 URL'}</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}
            {type === 'EMAIL' && (
              <p className="text-xs text-muted-foreground">邮件投递为预留适配器，需服务端配置 SMTP 后方可生效，当前仅占位。</p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              启用该通道
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>取消</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name}>{editing ? '保存' : '添加'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
