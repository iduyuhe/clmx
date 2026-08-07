import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi, usersApi, authApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { useAuthStore } from '@/stores/authStore'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Paintbrush, Users, Activity, ClipboardList, Search, Plus, Pencil, Trash2, KeyRound, Building2, Gauge, HardDrive, BellRing, Receipt, Server } from 'lucide-react'
import type { AuditLog, User, ApiUsageRecord, TenantBranding, PlanDef } from '@/types/models'
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Boxes } from 'lucide-react'
import { IndustryAdminTab } from './IndustryAdminTab'
import { AlertChannelsTab } from './AlertChannelsTab'
import { DemoDataTab } from './DemoDataTab'
import { BillingTab } from './BillingTab'
import { OpcuaTab } from './OpcuaTab'

const ROLE_LABELS: Record<string, string> = { ADMIN: '管理员', MANAGER: '管理者', ANNOTATOR: '标注员', VIEWER: '观察者' }
const STATUS_LABELS: Record<string, string> = { ACTIVE: '正常', DISABLED: '已禁用', PENDING: '待激活' }

export function SettingsPage() {
  const [tab, setTab] = useState<'branding' | 'members' | 'usage' | 'audit' | 'industries' | 'alerts' | 'demo' | 'billing' | 'opcua'>('branding')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">系统设置</h1>
        <p className="text-sm text-muted-foreground mt-1">管理租户配置、成员、用量和审计日志</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'branding', label: '品牌定制', icon: Paintbrush },
          { id: 'members',  label: '成员管理', icon: Users },
          { id: 'industries', label: '行业场景', icon: Building2 },
          { id: 'usage',    label: '用量与配额', icon: Activity },
          { id: 'audit',    label: '审计日志', icon: ClipboardList },
          { id: 'alerts',   label: '告警通道', icon: BellRing },
          { id: 'demo',     label: '演示数据', icon: Boxes },
          { id: 'billing',  label: '账单计费', icon: Receipt },
          { id: 'opcua',    label: 'OPC-UA 接入', icon: Server },
        ].map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab(t.id as typeof tab)}
          >
            <t.icon className="mr-2 h-4 w-4" />{t.label}
          </Button>
        ))}
      </div>

      {tab === 'branding' && <BrandingTab />}
      {tab === 'members'     && <MembersTab />}
      {tab === 'industries'  && <IndustryAdminTab />}
      {tab === 'usage'       && <UsageTab />}
      {tab === 'audit'    && <AuditLogTab />}
      {tab === 'alerts'   && <AlertChannelsTab />}
      {tab === 'demo'     && <DemoDataTab />}
      {tab === 'billing'   && <BillingTab />}
      {tab === 'opcua'     && <OpcuaTab />}
    </div>
  )
}

/* ---- 品牌定制（白标） ---- */
function BrandingTab() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({ queryKey: ['settings', 'tenant'], queryFn: () => settingsApi.getTenant() })
  const tenant = data?.data
  const [companyName, setCompanyName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#3b82f6')
  const [logoUrl, setLogoUrl] = useState('')
  const [faviconUrl, setFaviconUrl] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [initialized, setInitialized] = useState(false)

  // Sync form values when data loads
  if (tenant && !initialized) {
    const b = tenant.branding as TenantBranding | null
    setCompanyName(b?.companyName || '')
    setPrimaryColor(b?.primaryColor || '#3b82f6')
    setLogoUrl(b?.logoUrl || '')
    setFaviconUrl(b?.faviconUrl || '')
    setCustomDomain(b?.customDomain || '')
    setInitialized(true)
  }

  const saveMut = useMutation({
    mutationFn: () => settingsApi.updateBranding({ companyName, primaryColor, logoUrl, faviconUrl, customDomain }),
    onSuccess: async () => {
      toast.success('品牌设置已保存')
      qc.invalidateQueries({ queryKey: ['settings', 'tenant'] })
      // 立即刷新全局用户态，使侧边栏/登录页白标即时生效
      try { const me = await authApi.me(); if (me.data) useAuthStore.getState().setUser(me.data) } catch { /* ignore */ }
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '保存失败')),
  })

  if (isLoading) return <Skeleton className="h-64" />
  if (isError) return <Empty><EmptyMedia><Boxes className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyTitle>加载失败</EmptyTitle><EmptyDescription>无法加载租户信息，请刷新重试</EmptyDescription></Empty>
  if (!tenant)   return <Empty><EmptyMedia><Boxes className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyTitle>暂无租户信息</EmptyTitle></Empty>

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>品牌定制</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>公司名称</Label>
            <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="公司名称" />
          </div>
          <div className="grid gap-2">
            <Label>主色调</Label>
            <div className="flex items-center gap-2">
              <Input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="h-10 w-16 p-1" />
              <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} placeholder="#3b82f6" className="w-32" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Logo 图片 URL</Label>
            <Input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://.../logo.png" />
          </div>
          <div className="grid gap-2">
            <Label>Favicon URL</Label>
            <Input value={faviconUrl} onChange={e => setFaviconUrl(e.target.value)} placeholder="https://.../favicon.ico" />
          </div>
          <div className="grid gap-2">
            <Label>自定义域名</Label>
            <Input value={customDomain} onChange={e => setCustomDomain(e.target.value)} placeholder="app.your-company.com" />
          </div>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? '保存中...' : '保存'}
          </Button>
        </CardContent>
      </Card>

      {/* 实时预览 */}
      <Card className="h-fit">
        <CardHeader><CardTitle>预览</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border p-4">
            {logoUrl
              ? <img src={logoUrl} alt="logo" className="h-10 w-10 rounded object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
              : <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">LOGO</div>}
            <span className="text-lg font-semibold" style={{ color: primaryColor }}>{companyName || '公司名称'}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" style={{ backgroundColor: primaryColor, color: '#fff' }}>主按钮</Button>
            <Button size="sm" variant="outline">次按钮</Button>
          </div>
          {customDomain && (
            <p className="text-xs text-muted-foreground">自定义域名：{customDomain}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ---- 成员管理 ---- */
function MembersTab() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const pageSize = 20

  // 对话框状态
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser]     = useState<User | null>(null)
  const [pwdUser, setPwdUser]       = useState<User | null>(null)

  // 表单状态
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'MEMBER' })
  const [editForm, setEditForm] = useState({ name: '', role: 'MEMBER', status: 'ACTIVE' })
  const [newPwd, setNewPwd]   = useState('')

  // 查询用户列表
  const { data, isLoading } = useQuery({
    queryKey: ['users', 'list', page],
    queryFn: () => usersApi.list({ page, pageSize }),
  })
  const users      = data?.data || []
  const total      = data?.total || 0
  const totalPages = data?.totalPages || 1

  // 创建用户
  const createMut = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => { toast.success('用户创建成功'); setCreateOpen(false); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '创建失败')),
  })

  // 更新用户
  const updateMut = useMutation({
    mutationFn: ({ id, req }: { id: string; req: { name?: string; role?: string; status?: string } }) => usersApi.update(id, req),
    onSuccess: () => { toast.success('更新成功'); setEditUser(null); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '更新失败')),
  })

  // 重置密码
  const pwdMut = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) => usersApi.resetPassword(id, newPassword),
    onSuccess: () => { toast.success('密码已重置'); setPwdUser(null); setNewPwd('') },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '重置失败')),
  })

  // 删除用户
  const deleteMut = useMutation({
    mutationFn: usersApi.remove,
    onSuccess: () => { toast.success('用户已删除'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '删除失败')),
  })

  const openEdit = (u: User) => {
    setEditForm({ name: u.name, role: u.role, status: u.status })
    setEditUser(u)
  }

  const confirmDelete = (u: User) => {
    if (window.confirm(`确定要删除用户「${u.name}」吗？此操作不可撤销。`)) {
      deleteMut.mutate(u.id)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>成员管理</CardTitle>
        <Button size="sm" onClick={() => { setForm({ email: '', name: '', password: '', role: 'MEMBER' }); setCreateOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />添加成员
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : users.length === 0 ? (
          <Empty className="py-8"><EmptyMedia><Users className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyDescription>暂无成员，点击「添加成员」创建第一个用户</EmptyDescription></Empty>
        ) : (
          <>
            <div className="divide-y">
              {users.map((u: User) => (
                <div key={u.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-muted">{ROLE_LABELS[u.role] || u.role}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${u.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : u.status === 'DISABLED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{STATUS_LABELS[u.status] || u.status}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setNewPwd(''); setPwdUser(u) }}><KeyRound className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => confirmDelete(u)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">共 {total} 人</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
                  <span className="px-2 py-1 text-xs">{page}/{totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* 创建用户对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加成员</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1">
              <Label>邮箱 *</Label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" />
            </div>
            <div className="grid gap-1">
              <Label>姓名 *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="用户名" />
            </div>
            <div className="grid gap-1">
              <Label>密码 *</Label>
              <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="至少6位" />
            </div>
            <div className="grid gap-1">
              <Label>角色</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">管理员</SelectItem>
                  <SelectItem value="MANAGER">管理者</SelectItem>
                  <SelectItem value="ANNOTATOR">标注员</SelectItem>
                  <SelectItem value="VIEWER">观察者</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={() => {
              if (!form.email || !form.name || !form.password) return toast.error('请填写必填项')
              if (form.password.length < 6) return toast.error('密码至少6位')
              createMut.mutate(form)
            }} disabled={createMut.isPending}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑用户对话框 */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑成员 — {editUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1">
              <Label>姓名</Label>
              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>角色</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">管理员</SelectItem>
                  <SelectItem value="MANAGER">管理者</SelectItem>
                  <SelectItem value="ANNOTATOR">标注员</SelectItem>
                  <SelectItem value="VIEWER">观察者</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>状态</Label>
              <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">正常</SelectItem>
                  <SelectItem value="DISABLED">已禁用</SelectItem>
                  <SelectItem value="PENDING">待激活</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>取消</Button>
            <Button onClick={() => {
              if (!editUser) return
              updateMut.mutate({ id: editUser.id, req: editForm })
            }} disabled={updateMut.isPending}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码对话框 */}
      <Dialog open={!!pwdUser} onOpenChange={() => { setPwdUser(null); setNewPwd('') }}>
        <DialogContent>
          <DialogHeader><DialogTitle>重置密码 — {pwdUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1">
              <Label>新密码 *</Label>
              <Input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少6位" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwdUser(null); setNewPwd('') }}>取消</Button>
            <Button onClick={() => {
              if (!pwdUser || !newPwd) return toast.error('请输入新密码')
              if (newPwd.length < 6) return toast.error('密码至少6位')
              pwdMut.mutate({ id: pwdUser.id, newPassword: newPwd })
            }} disabled={pwdMut.isPending}>重置密码</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* ---- 用量与配额（计费看板） ---- */
const PLAN_LABELS: Record<string, string> = { TRIAL: '试用', FREE: '免费版', PRO: '专业版', ENTERPRISE: '企业版' }
const PLAN_ORDER: string[] = ['TRIAL', 'FREE', 'PRO', 'ENTERPRISE']
function UsageTab() {
  const [recPage, setRecPage] = useState(1)
  const recPageSize = 10
  const { data: tData, isLoading: tLoading, isError: tError } = useQuery({ queryKey: ['settings', 'tenant'], queryFn: () => settingsApi.getTenant() })
  const { data: uData, isLoading: uLoading, isError: uError } = useQuery({ queryKey: ['settings', 'usage'], queryFn: () => settingsApi.getUsage() })
  const { data: plansData } = useQuery({ queryKey: ['settings', 'plans'], queryFn: () => settingsApi.getPlans() })
  const { data: recData, isLoading: recLoading } = useQuery({
    queryKey: ['settings', 'usage-records', recPage],
    queryFn: () => settingsApi.getUsageRecords({ page: recPage, pageSize: recPageSize }),
  })
  const qc = useQueryClient()
  const tenant = tData?.data
  const usage = uData?.data
  const plans: PlanDef[] = plansData?.data || []
  const records: ApiUsageRecord[] = recData?.data || []
  const recTotal = recData?.total || 0
  const recTotalPages = recData?.totalPages || 1

  // 套餐变更对话框状态
  const [planDialog, setPlanDialog] = useState(false)
  const [targetPlan, setTargetPlan] = useState<string | null>(null)

  if (tLoading || uLoading) return <Skeleton className="h-64" />
  if (tError || uError) return <Empty><EmptyMedia><Activity className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyTitle>加载失败</EmptyTitle><EmptyDescription>无法加载用量数据，请刷新重试</EmptyDescription></Empty>

  const planType = tenant?.planType || 'FREE'
  const storageUsed = tenant?.storageUsed || 0
  const storageLimit = tenant?.storageLimit || 0
  const storagePct = tenant?.storagePct ?? (storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0)
  const apiQuota = tenant?.apiCallQuota || 0
  const apiUsed = tenant?.apiCallsUsed || 0
  const apiUnlimited = apiQuota <= 0
  const apiPct = tenant?.apiPct ?? (apiUnlimited ? 0 : Math.min(100, (apiUsed / apiQuota) * 100))
  const storageBreached = tenant?.storageBreached ?? storagePct >= 100
  const apiBreached = tenant?.apiBreached ?? (!apiUnlimited && apiPct >= 100)
  const storageSoft = tenant?.storageSoft ?? (storagePct >= 90 && storagePct < 100)
  const apiSoft = tenant?.apiSoft ?? (!apiUnlimited && apiPct >= 90 && apiPct < 100)

  // 客户端护栏预览：所选目标套餐是否会违反当前用量
  const targetDef = plans.find((p) => p.id === targetPlan)
  const wouldBreachStorage = !!targetDef && storageUsed > targetDef.storageLimit
  const wouldBreachApi = !!targetDef && targetDef.apiCallQuota > 0 && apiUsed > targetDef.apiCallQuota
  const isDowngrade = !!targetPlan && PLAN_ORDER.indexOf(targetPlan) < PLAN_ORDER.indexOf(planType)

  const changeMut = useMutation({
    mutationFn: () => settingsApi.changePlan({ planType: targetPlan! }),
    onSuccess: () => {
      toast.success('套餐已变更')
      setPlanDialog(false)
      setTargetPlan(null)
      qc.invalidateQueries({ queryKey: ['settings', 'tenant'] })
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '套餐变更失败')),
  })

  const exportCsv = async () => {
    try {
      const blob = await settingsApi.exportUsage({ format: 'csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `clmx-usage-${Date.now()}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('用量报表已导出')
    } catch {
      toast.error('导出失败')
    }
  }

  return (
    <div className="space-y-4">
      {/* 套餐与配额 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-muted-foreground" />套餐与配额</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{PLAN_LABELS[planType] || planType}</Badge>
            <Button size="sm" variant="outline" onClick={() => setPlanDialog(true)}><Gauge className="mr-2 h-4 w-4" />变更套餐</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-muted-foreground" />存储空间</span>
              <span className="text-muted-foreground">{storageUsed.toLocaleString()} / {storageLimit.toLocaleString()} 数据点（{storagePct.toFixed(1)}%）</span>
            </div>
            <Progress value={storagePct} className={storageBreached ? 'bg-destructive/20' : storageSoft ? 'bg-yellow-500/20' : undefined} />
            {storageBreached && <p className="text-xs text-destructive">存储配额已熔断，新数据摄入被拒绝，请升级套餐或清理历史数据。</p>}
            {storageSoft && !storageBreached && <p className="text-xs text-yellow-600">存储空间即将用尽（&ge;90%），建议尽快升级。</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-muted-foreground" />API 调用配额</span>
              <span className="text-muted-foreground">{apiUnlimited ? `已用 ${apiUsed.toLocaleString()}（不限量）` : `${apiUsed.toLocaleString()} / ${apiQuota.toLocaleString()}`}</span>
            </div>
            <Progress value={apiPct} className={apiBreached ? 'bg-destructive/20' : apiSoft ? 'bg-yellow-500/20' : undefined} />
            {apiBreached && <p className="text-xs text-destructive">API 配额已熔断，推理调用被拒绝（HTTP 429），请升级套餐。</p>}
            {apiSoft && !apiBreached && <p className="text-xs text-yellow-600">API 调用即将触顶（&ge;90%），建议升级以免服务中断。</p>}
          </div>
        </CardContent>
      </Card>

      {/* 调用概览 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>调用概览</CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv}><ClipboardList className="mr-2 h-4 w-4" />导出用量 CSV</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">总调用次数</p>
              <p className="text-2xl font-semibold mt-1">{usage?.totalCalls?.toLocaleString() || 0}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">总 Token 用量</p>
              <p className="text-2xl font-semibold mt-1">{usage?.totalTokens?.toLocaleString() || 0}</p>
            </div>
          </div>
          {usage?.dailyStats && usage.dailyStats.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">近 7 日趋势</p>
              <div className="flex items-end gap-2 h-32">
                {usage.dailyStats.map((d) => {
                  const maxCalls = Math.max(...usage.dailyStats.map(s => s.calls), 1)
                  const heightPct = (d.calls / maxCalls) * 100
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-primary/20 rounded-t" style={{ height: `${heightPct}%`, minHeight: '2px' }} />
                      <span className="text-xs text-muted-foreground">{d.date}</span>
                      <span className="text-xs">{d.calls}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 用量明细 */}
      <Card>
        <CardHeader><CardTitle>近期调用明细</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>部署 ID</TableHead>
                <TableHead>请求/响应 Token</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recLoading ? (
                <TableRow><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">暂无调用记录</TableCell></TableRow>
              ) : records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.timestamp).toLocaleString('zh-CN')}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[160px] truncate">{r.deploymentId}</TableCell>
                  <TableCell className="text-xs">{r.requestTokens} / {r.responseTokens}</TableCell>
                  <TableCell className="text-xs">{r.latencyMs} ms</TableCell>
                  <TableCell><Badge variant={r.statusCode < 400 ? 'default' : 'destructive'}>{r.statusCode}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {recTotalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">共 {recTotal} 条</p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={recPage <= 1} onClick={() => setRecPage(p => p - 1)}>上一页</Button>
                <span className="px-2 py-1 text-xs">{recPage}/{recTotalPages}</span>
                <Button size="sm" variant="outline" disabled={recPage >= recTotalPages} onClick={() => setRecPage(p => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 套餐变更对话框 */}
      <Dialog open={planDialog} onOpenChange={(o) => { setPlanDialog(o); if (!o) setTargetPlan(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>变更套餐</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {plans.map((p) => {
              const isCurrent = p.id === planType
              const downgrade = PLAN_ORDER.indexOf(p.id) < PLAN_ORDER.indexOf(planType)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setTargetPlan(p.id)}
                  className={`rounded-lg border p-3 text-left transition ${targetPlan === p.id ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50'} ${isCurrent ? 'bg-muted/50' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.label}</span>
                    {isCurrent && <Badge variant="secondary">当前</Badge>}
                    {downgrade && !isCurrent && <Badge variant="outline">降级</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p.priceMonthly > 0 ? `¥${p.priceMonthly.toLocaleString()}/月` : '免费'} · {p.apiCallQuota > 0 ? `${p.apiCallQuota.toLocaleString()} 次调用` : '不限量'} · {(p.storageLimit / 1_000_000).toLocaleString()}M 存储
                  </p>
                  <ul className="mt-2 space-y-0.5">
                    {p.features.slice(0, 3).map((f) => (
                      <li key={f} className="text-xs text-muted-foreground">· {f}</li>
                    ))}
                  </ul>
                </button>
              )
            })}
          </div>
          {targetPlan && (
            <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs">
              {isDowngrade && (wouldBreachStorage || wouldBreachApi) ? (
                <p className="text-destructive">
                  无法降级到「{targetDef?.label}」：当前用量{wouldBreachStorage ? '（存储）' : ''}{wouldBreachApi ? '（API 调用）' : ''}已超过该套餐上限。请先清理数据/升级。
                </p>
              ) : isDowngrade ? (
                <p className="text-yellow-600">将从「{PLAN_LABELS[planType]}」降级到「{targetDef?.label}」，降级后立即按新套餐配额计量。</p>
              ) : (
                <p className="text-muted-foreground">将升级/切换到「{targetDef?.label}」，变更后立即生效。</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPlanDialog(false); setTargetPlan(null) }}>取消</Button>
            <Button
              disabled={!targetPlan || targetPlan === planType || (isDowngrade && (wouldBreachStorage || wouldBreachApi)) || changeMut.isPending}
              onClick={() => changeMut.mutate()}
            >
              {changeMut.isPending ? '变更中...' : '确认变更'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ---- 审计日志 ---- */
function AuditLogTab() {
  const [page, setPage]             = useState(1)
  const [actionFilter, setActionFilter] = useState<string>('')
  const [search, setSearch]         = useState('')

  const pageSize = 20

  const { data: actionsData } = useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: () => settingsApi.getAuditActions(),
  })
  const actionOptions = actionsData?.data || []

  const { data, isLoading } = useQuery({
    queryKey: ['audit', 'logs', page, actionFilter],
    queryFn: () => settingsApi.getAuditLogs({
      page,
      pageSize,
      ...(actionFilter ? { action: actionFilter } : {}),
    }),
  })
  const logs       = data?.data || []
  const total      = data?.total || 0
  const totalPages = data?.totalPages || 1

  const fmtTime = (s: string) => new Date(s).toLocaleString('zh-CN')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>审计日志</CardTitle>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索操作人/资源..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 w-56 text-xs"
            />
          </div>
          <Select value={actionFilter || 'all'} onValueChange={v => { setActionFilter(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="全部操作" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部操作</SelectItem>
              {actionOptions.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : logs.length === 0 ? (
          <Empty className="py-8"><EmptyMedia><ClipboardList className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyDescription>暂无审计日志</EmptyDescription></Empty>
        ) : (
          <>
            <div className="divide-y">
              {logs
                .filter((l: AuditLog) => {
                  if (!search) return true
                  const q = search.toLowerCase()
                  return (
                    l.user?.name?.toLowerCase().includes(q) ||
                    l.user?.email?.toLowerCase().includes(q) ||
                    l.actionLabel?.toLowerCase().includes(q) ||
                    l.resource?.toLowerCase().includes(q)
                  )
                })
                .map((l: AuditLog) => (
                  <div key={l.id} className="px-4 py-3 flex items-start gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary">{l.actionLabel || l.action}</span>
                        {l.resource && <span className="text-xs text-muted-foreground">「{l.resource}」</span>}
                      </div>
                      {l.detail && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {JSON.stringify(l.detail).slice(0, 120)}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{l.user?.name || l.userId}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(l.createdAt)}</p>
                    </div>
                  </div>
                ))}
            </div>
            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">共 {total} 条</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
                  <span className="px-2 py-1 text-xs">{page}/{totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
