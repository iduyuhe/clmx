import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { modelsApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Empty, EmptyMedia, EmptyDescription } from '@/components/ui/empty'
import { ArrowLeft, Play, Rocket, Trash2, GitBranch } from 'lucide-react'
import { formatDate, statusLabel } from '@/lib/formatters'
import type { ModelVersion } from '@/types/models'

export function ModelDetailPage() {
  const { modelId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['model', modelId],
    queryFn: () => modelsApi.get(modelId!),
    enabled: !!modelId,
  })

  const deleteMut = useMutation({
    mutationFn: modelsApi.remove,
    onSuccess: () => { toast.success('模型已删除'); qc.invalidateQueries({ queryKey: ['models'] }); navigate('/app/models') },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '删除失败')),
  })

  const confirmDelete = (name: string) => {
    if (window.confirm(`确定要删除模型「${name}」吗？此操作不可撤销。`)) {
      deleteMut.mutate(modelId!)
    }
  }

  const model = data?.data

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>
  if (!model) return <div className="py-20 text-center text-muted-foreground">模型不存在</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/models')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{model.name}</h1>
            <Badge>{statusLabel(model.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{model.description}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate(`/app/models/${modelId}/train`)} size="sm">
            <Play className="mr-2 h-4 w-4" />发起训练
          </Button>
          {model.status === 'TRAINED' && (
            <Button variant="outline" onClick={() => navigate('/app/deployments/new')} size="sm">
              <Rocket className="mr-2 h-4 w-4" />部署
            </Button>
          )}
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => confirmDelete(model.name)}>
            <Trash2 className="mr-2 h-4 w-4" />删除模型
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">基座模型</p><p className="font-medium">{model.baseModel}</p></CardContent></Card>
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">行业</p><p className="font-medium">{model.industry}</p></CardContent></Card>
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">场景</p><p className="font-medium">{model.scenario}</p></CardContent></Card>
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">创建时间</p><p className="font-medium">{formatDate(model.createdAt)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">版本历史</CardTitle></CardHeader>
        <CardContent className="p-0">
          {model.versions && model.versions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>指标</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.versions.map((v: ModelVersion) => (
                  <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/app/models/${modelId}/versions/${v.id}`)}>
                    <TableCell className="font-medium">v{v.versionNumber}</TableCell>
                    <TableCell><Badge variant="outline">{v.status}</Badge></TableCell>
                    <TableCell className="text-sm">
                      {v.metrics ? Object.entries(v.metrics).map(([k, val]) => (
                        <span key={k} className="mr-2">{k}: {typeof val === 'number' ? val.toFixed(3) : String(val)}</span>
                      )) : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(v.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty className="py-8"><EmptyMedia><GitBranch className="h-8 w-8 text-muted-foreground" /></EmptyMedia><EmptyDescription>暂无版本，请先发起训练</EmptyDescription></Empty>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
