import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { billingApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Receipt, CreditCard, Loader2, CheckCircle2, Smartphone, Building2, QrCode } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  OPEN: '待支付',
  PAID: '已结清',
  VOID: '已作废',
}
const STATUS_VARIANT: Record<string, 'secondary' | 'default' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  OPEN: 'secondary',
  PAID: 'default',
  VOID: 'destructive',
}
const PAY_METHODS = [
  { id: 'alipay', label: '支付宝', icon: Smartphone },
  { id: 'wechat', label: '微信支付', icon: QrCode },
  { id: 'bank', label: '银行转账', icon: Building2 },
]

export function BillingTab() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [payDialog, setPayDialog] = useState<{ id: string; number: string; amount: number } | null>(null)
  const [payMethod, setPayMethod] = useState('alipay')
  const [payStep, setPayStep] = useState<'select' | 'scan' | 'confirm' | 'success'>('select')
  const pageSize = 20

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'invoices', page],
    queryFn: () => billingApi.list({ page, pageSize }),
  })
  const invoices = data?.data || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1

  const genMut = useMutation({
    mutationFn: () => billingApi.generateMonthly(),
    onSuccess: () => {
      toast.success('已生成本月账单')
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '生成失败')),
  })

  const payMut = useMutation({
    mutationFn: (id: string) => billingApi.pay(id),
    onSuccess: () => {
      toast.success('支付成功')
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '支付失败')),
  })

  const openPay = (inv: { id: string; number: string; amount: number }) => {
    setPayDialog(inv)
    setPayMethod('alipay')
    setPayStep('select')
  }

  const doPay = () => {
    if (!payDialog) return
    payMut.mutate(payDialog.id, {
      onSuccess: () => {
        setPayStep('success')
        setTimeout(() => { setPayDialog(null); setPayStep('select') }, 2000)
      },
    })
  }

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('zh-CN') : '—')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" />账单与计费
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => genMut.mutate()} disabled={genMut.isPending}>
          {genMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />}
          {genMut.isPending ? '生成中...' : '生成本月账单'}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : invoices.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            暂无账单，点击右上角「生成本月账单」生成演示账单（依据当前用量估算）。
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账单号</TableHead>
                  <TableHead>账期</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>到期日</TableHead>
                  <TableHead>支付日</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.number}</TableCell>
                    <TableCell>{inv.period}</TableCell>
                    <TableCell className="font-medium">¥{inv.amount.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[inv.status] || 'secondary'}>{STATUS_LABELS[inv.status] || inv.status}</Badge></TableCell>
                    <TableCell className="text-xs">{fmt(inv.dueDate)}</TableCell>
                    <TableCell className="text-xs">{fmt(inv.paidAt)}</TableCell>
                    <TableCell className="text-right">
                      {inv.status === 'OPEN' && (
                        <Button size="sm" variant="default" onClick={() => openPay(inv)} disabled={payMut.isPending}>
                          {payMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CreditCard className="mr-1 h-3.5 w-3.5" />}
                          支付
                        </Button>
                      )}
                      {inv.status === 'PAID' && <span className="text-xs text-green-600">已结清</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">共 {total} 条</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                  <span className="px-2 py-1 text-xs">{page}/{totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* 支付对话框 */}
      <Dialog open={!!payDialog} onOpenChange={() => { setPayDialog(null); setPayStep('select') }}>
        <DialogContent className="max-w-md">
          {payStep === 'select' && payDialog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />支付账单
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-muted/40 p-4 text-center">
                  <p className="text-sm text-muted-foreground">{payDialog.number}</p>
                  <p className="text-3xl font-semibold mt-1">¥{payDialog.amount.toLocaleString()}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">选择支付方式</p>
                  {PAY_METHODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPayMethod(m.id)}
                      className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition ${payMethod === m.id ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/50'}`}
                    >
                      <m.icon className={`h-5 w-5 ${payMethod === m.id ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="text-sm font-medium">{m.label}</span>
                      {payMethod === m.id && <span className="ml-auto text-xs text-primary">待支付</span>}
                    </button>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPayDialog(null)}>取消</Button>
                <Button onClick={() => setPayStep('scan')}>下一步</Button>
              </DialogFooter>
            </>
          )}
          {payStep === 'scan' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <QrCode className="h-5 w-5" />扫码支付
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center py-6 space-y-4">
                <div className="w-48 h-48 bg-white rounded-xl flex items-center justify-center border-2 border-dashed border-muted-foreground/30">
                  <div className="text-center">
                    <QrCode className="h-16 w-16 mx-auto text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground mt-2">模拟二维码</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  请使用{PAY_METHODS.find(m => m.id === payMethod)?.label}扫描上方二维码完成支付
                </p>
                <p className="text-xs text-muted-foreground">演示模式：点击「确认支付」模拟完成</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPayStep('select')}>上一步</Button>
                <Button onClick={doPay} disabled={payMut.isPending}>
                  {payMut.isPending ? '支付中...' : `确认支付 ¥${payDialog?.amount.toLocaleString()}`}
                </Button>
              </DialogFooter>
            </>
          )}
          {payStep === 'success' && (
            <div className="flex flex-col items-center py-8 space-y-3">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <p className="text-lg font-semibold">支付成功</p>
              <p className="text-sm text-muted-foreground">账单 {payDialog?.number} 已结清</p>
              <Badge variant="default" className="mt-2">¥{payDialog?.amount.toLocaleString()}</Badge>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
