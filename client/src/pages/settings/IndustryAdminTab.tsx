import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { industriesApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Pencil, Trash2, Factory } from 'lucide-react'
import type { Industry, Scenario } from '@/types/models'

export function IndustryAdminTab() {
  const queryClient = useQueryClient()
  const [editingIndustry, setEditingIndustry] = useState<Industry | null>(null)
  const [creatingIndustry, setCreatingIndustry] = useState(false)
  const [editingScenario, setEditingScenario] = useState<{ industry: Industry; scenario: Scenario | null } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['industries'],
    queryFn: () => industriesApi.list(),
  })

  const industries = data?.data || []

  const createMutation = useMutation({
    mutationFn: (req: { name: string; code: string; description: string; icon: string }) => industriesApi.create(req),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['industries'] }); setCreatingIndustry(false); toast.success('行业已创建') },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '创建失败')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; icon?: string }) => industriesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['industries'] }); setEditingIndustry(null); toast.success('行业已更新') },
    onError: () => toast.error('更新失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => industriesApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['industries'] }); toast.success('行业已删除') },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '删除失败')),
  })

  const createScenarioMutation = useMutation({
    mutationFn: ({ industryId, ...req }: { industryId: string; name: string; code: string; description: string; promptTemplate: string }) =>
      industriesApi.createScenario(industryId, req),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['industries'] }); setEditingScenario(null); toast.success('场景已创建') },
    onError: () => toast.error('创建失败'),
  })

  const updateScenarioMutation = useMutation({
    mutationFn: ({ industryId, scenarioId, ...data }: { industryId: string; scenarioId: string; name?: string; description?: string; promptTemplate?: string }) =>
      industriesApi.updateScenario(industryId, scenarioId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['industries'] }); setEditingScenario(null); toast.success('场景已更新') },
    onError: () => toast.error('更新失败'),
  })

  const deleteScenarioMutation = useMutation({
    mutationFn: ({ industryId, scenarioId }: { industryId: string; scenarioId: string }) =>
      industriesApi.removeScenario(industryId, scenarioId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['industries'] }); toast.success('场景已删除') },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '删除失败')),
  })

  if (isLoading) return <Skeleton className="h-64" />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">行业与场景管理</h2>
          <p className="text-sm text-muted-foreground">管理平台的行业分类和业务场景</p>
        </div>
        <Button size="sm" onClick={() => setCreatingIndustry(true)}>
          <Plus className="mr-1 h-4 w-4" />新建行业
        </Button>
      </div>

      {industries.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">暂无行业数据，请先创建</p>
      ) : (
        <div className="space-y-4">
          {industries.map((ind) => (
            <Card key={ind.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Factory className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{ind.name}</CardTitle>
                    <span className="text-xs text-muted-foreground">({ind.code})</span>
                    {ind.isPreset && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">预置</span>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingIndustry(ind)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!ind.isPreset && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => {
                        if (confirm(`确定删除行业「${ind.name}」及其所有场景？`)) deleteMutation.mutate(ind.id)
                      }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                {ind.description && <p className="text-sm text-muted-foreground">{ind.description}</p>}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">场景列表</p>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditingScenario({ industry: ind, scenario: null })}>
                    <Plus className="mr-1 h-3 w-3" />添加场景
                  </Button>
                </div>
                {ind.scenarios && ind.scenarios.length > 0 ? (
                  <div className="space-y-1.5">
                    {ind.scenarios.map((sc) => (
                      <div key={sc.id} className="flex items-center justify-between py-1 px-2 rounded bg-muted/50">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{sc.name}</span>
                          <span className="text-xs text-muted-foreground">({sc.code})</span>
                          {sc.isPreset && <span className="text-xs bg-muted px-1 rounded">预置</span>}
                        </div>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingScenario({ industry: ind, scenario: sc })}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {!sc.isPreset && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => {
                              if (confirm(`确定删除场景「${sc.name}」？`))
                                deleteScenarioMutation.mutate({ industryId: ind.id, scenarioId: sc.id })
                            }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">暂无场景</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 创建/编辑行业对话框 */}
      <Dialog open={creatingIndustry || !!editingIndustry} onOpenChange={(o) => { if (!o) { setCreatingIndustry(false); setEditingIndustry(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingIndustry ? '编辑行业' : '新建行业'}</DialogTitle>
          </DialogHeader>
          <IndustryForm
            initial={editingIndustry}
            onSubmit={(data) => {
              if (editingIndustry) {
                updateMutation.mutate({ id: editingIndustry.id, ...data })
              } else {
                createMutation.mutate(data)
              }
            }}
            loading={createMutation.isPending || updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* 创建/编辑场景对话框 */}
      <Dialog open={!!editingScenario} onOpenChange={(o) => { if (!o) setEditingScenario(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingScenario?.scenario ? '编辑场景' : `为「${editingScenario?.industry?.name}」添加场景`}
            </DialogTitle>
          </DialogHeader>
          <ScenarioForm
            initial={editingScenario?.scenario || undefined}
            onSubmit={(data) => {
              if (!editingScenario) return
              if (editingScenario.scenario) {
                updateScenarioMutation.mutate({
                  industryId: editingScenario.industry.id,
                  scenarioId: editingScenario.scenario.id,
                  ...data,
                })
              } else {
                createScenarioMutation.mutate({
                  industryId: editingScenario.industry.id,
                  ...data,
                })
              }
            }}
            loading={createScenarioMutation.isPending || updateScenarioMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IndustryForm({ initial, onSubmit, loading }: {
  initial?: Industry | null
  onSubmit: (data: { name: string; code: string; description: string; icon: string }) => void
  loading: boolean
}) {
  const [name, setName] = useState(initial?.name || '')
  const [code, setCode] = useState(initial?.code || '')
  const [description, setDesc] = useState(initial?.description || '')
  const [icon, setIcon] = useState(initial?.icon || 'factory')

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, code, description, icon }) }} className="space-y-4">
      <div>
        <Label>行业名称 *</Label>
        <Input value={name} onChange={e => setName(e.target.value)} required placeholder="如：医疗健康" />
      </div>
      <div>
        <Label>编码 *</Label>
        <Input value={code} onChange={e => setCode(e.target.value)} required placeholder="如：healthcare" disabled={!!initial} />
        {!!initial && <p className="text-xs text-muted-foreground mt-1">编码不可修改</p>}
      </div>
      <div>
        <Label>描述</Label>
        <Textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="行业描述" rows={2} />
      </div>
      <div>
        <Label>图标</Label>
        <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="factory" />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={loading || !name || !code}>{loading ? '保存中...' : '保存'}</Button>
      </DialogFooter>
    </form>
  )
}

function ScenarioForm({ initial, onSubmit, loading }: {
  initial?: Scenario
  onSubmit: (data: { name: string; code: string; description: string; promptTemplate: string }) => void
  loading: boolean
}) {
  const [name, setName] = useState(initial?.name || '')
  const [code, setCode] = useState(initial?.code || '')
  const [description, setDesc] = useState(initial?.description || '')
  const [promptTemplate, setPrompt] = useState(initial?.promptTemplate || '')

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, code, description, promptTemplate }) }} className="space-y-4">
      <div>
        <Label>场景名称 *</Label>
        <Input value={name} onChange={e => setName(e.target.value)} required placeholder="如：智能问答" />
      </div>
      <div>
        <Label>编码 *</Label>
        <Input value={code} onChange={e => setCode(e.target.value)} required placeholder="如：qa" disabled={!!initial} />
      </div>
      <div>
        <Label>描述</Label>
        <Textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="场景描述" rows={2} />
      </div>
      <div>
        <Label>提示词模板</Label>
        <Textarea value={promptTemplate} onChange={e => setPrompt(e.target.value)} placeholder="如：你是一个{行业}专家，请回答..." rows={3} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={loading || !name || !code}>{loading ? '保存中...' : '保存'}</Button>
      </DialogFooter>
    </form>
  )
}
