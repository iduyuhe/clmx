import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { modelsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, BarChart3, Database, Clock, Rocket } from 'lucide-react'
import { formatDate } from '@/lib/formatters'
import type { ModelVersion } from '@/types/models'

export function ModelVersionDetailPage() {
  const { modelId, versionId } = useParams()
  const navigate = useNavigate()

  const { data: modelData, isLoading: modelLoading } = useQuery({
    queryKey: ['model', modelId],
    queryFn: () => modelsApi.get(modelId!),
    enabled: !!modelId,
  })

  const model = modelData?.data
  const versions = model?.versions || []
  const version = versions.find((v: ModelVersion) => v.id === versionId) as ModelVersion | undefined

  if (modelLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>
  if (!model) return <div className="py-20 text-center text-muted-foreground">模型不存在</div>
  if (!version) return <div className="py-20 text-center text-muted-foreground">版本不存在</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/app/models/${modelId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{model.name}</span>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-semibold">v{version.versionNumber}</h1>
            <Badge variant={version.status === 'TRAINED' ? 'default' : 'secondary'}>
              {version.status}
            </Badge>
          </div>
        </div>
        {version.status === 'TRAINED' && (
          <Button onClick={() => navigate('/app/deployments/new')} size="sm">
            <Rocket className="mr-2 h-4 w-4" />部署此版本
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 基本信息 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />基本信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">版本号</span>
              <span className="font-medium">v{version.versionNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">状态</span>
              <Badge variant="outline">{version.status}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">创建时间</span>
              <span>{formatDate(version.createdAt)}</span>
            </div>
            {version.checkpointPath && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Checkpoint</span>
                <span className="text-xs font-mono truncate max-w-[200px]">{version.checkpointPath}</span>
              </div>
            )}
            {version.trainingJobId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">训练任务</span>
                <Button variant="link" className="h-auto p-0 text-xs" onClick={() => navigate(`/app/training/${version.trainingJobId}`)}>
                  查看
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 部署状态 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Rocket className="h-4 w-4 text-muted-foreground" />部署状态
            </CardTitle>
          </CardHeader>
          <CardContent>
            {version.deployment ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">部署名称</span>
                  <span className="font-medium">{version.deployment.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <Badge variant={version.deployment.status === 'RUNNING' ? 'default' : 'secondary'}>
                    {version.deployment.status}
                  </Badge>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-2"
                  onClick={() => navigate(`/app/deployments/${version.deployment!.id}`)}>
                  查看部署详情
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">尚未部署</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 训练指标 */}
      {version.metrics && Object.keys(version.metrics).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />训练指标
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(version.metrics).map(([key, val]) => (
                <div key={key} className="bg-muted/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-semibold">{typeof val === 'number' ? val.toFixed(4) : String(val)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{key}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 评估摘要 */}
      {version.evaluationSummary && Object.keys(version.evaluationSummary).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />评估摘要
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded overflow-auto">
              {JSON.stringify(version.evaluationSummary, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
