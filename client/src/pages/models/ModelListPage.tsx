import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { modelsApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { SearchFilterBar } from '@/components/SearchFilterBar'
import { Plus, Brain, ArrowRight, Trash2 } from 'lucide-react'
import { formatDate, statusLabel } from '@/lib/formatters'

export function ModelListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['models'],
    queryFn: () => modelsApi.list(),
  })

  const deleteMut = useMutation({
    mutationFn: modelsApi.remove,
    onSuccess: () => { toast.success('模型已删除'); qc.invalidateQueries({ queryKey: ['models'] }) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '删除失败')),
  })

  const confirmDelete = (id: string, name: string) => {
    if (window.confirm(`确定要删除模型「${name}」吗？此操作不可撤销。`)) {
      deleteMut.mutate(id)
    }
  }

  const allModels = data?.data || []
  const models = allModels.filter((m) => {
    const matchSearch = !search || m.name?.toLowerCase().includes(search.toLowerCase())
      || m.baseModel?.toLowerCase().includes(search.toLowerCase())
      || m.industry?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || m.status === statusFilter
    return matchSearch && matchStatus
  })

  const statusVariant = (s: string) => {
    switch (s) { case 'TRAINED': return 'default'; case 'DRAFT': return 'secondary'; case 'TRAINING': return 'secondary'; case 'DEPLOYED': return 'default'; case 'ARCHIVED': return 'outline'; default: return 'outline' }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">模型管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理垂类大模型（Qwen2.5 / DeepSeek 基座）与中文文本分类（NLP）模型</p>
        </div>
        <Button onClick={() => navigate('/app/models/new')} size="sm">
          <Plus className="mr-2 h-4 w-4" /> 创建模型
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <SearchFilterBar
            searchValue={search}
            onSearchChange={v => setSearch(v)}
            searchPlaceholder="搜索名称、基座模型、行业..."
            filterValue={statusFilter}
            onFilterChange={setStatusFilter}
            filterOptions={[
              { value: 'DRAFT', label: '草稿' },
              { value: 'TRAINING', label: '训练中' },
              { value: 'TRAINED', label: '已训练' },
              { value: 'DEPLOYED', label: '已部署' },
              { value: 'ARCHIVED', label: '已归档' },
            ]}
            filterLabel="全部状态"
          />
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>基座模型</TableHead>
                <TableHead>行业/场景</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-muted-foreground">数据加载失败</p>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>
                  </div>
                </TableCell></TableRow>
              ) : isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : models.length === 0 && (search || statusFilter) ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  没有匹配的模型
                </TableCell></TableRow>
              ) : models.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />暂无模型，点击创建第一个
                </TableCell></TableRow>
              ) : (
                models.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/app/models/${m.id}`)}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-sm">{m.baseModel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.industry} / {m.scenario}</TableCell>
                    <TableCell><Badge variant={statusVariant(m.status)}>{statusLabel(m.status)}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(m.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7"><ArrowRight className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); confirmDelete(m.id, m.name) }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
