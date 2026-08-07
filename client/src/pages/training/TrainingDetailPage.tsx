import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { trainingApi, modelsApi } from '@/api'
import type { LossPoint, ModelVersion } from '@/types/models'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Pause, Play, Square, BarChart3, Zap, Target, CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { statusLabel, formatDate } from '@/lib/formatters'

export function TrainingDetailPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const [controlLoading, setControlLoading] = useState<'pause' | 'resume' | 'stop' | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['training', jobId],
    queryFn: () => trainingApi.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      return status === 'RUNNING' ? 2000 : false
    },
  })

  const job = useMemo(() => data?.data ?? null, [data])
  const lossData = useMemo(() =>
    job?.lossHistory?.map((lp: LossPoint) => ({ step: lp.step, loss: lp.loss })) ?? []
  , [job])

  // 训练完成后取模型版本指标（NLP accuracy 等）
  const isCompleted = job?.status === 'COMPLETED'
  const { data: modelVersionData } = useQuery({
    queryKey: ['model-version-metrics', job?.model?.id, job?.modelVersionId],
    queryFn: async () => {
      const res = await modelsApi.get(job!.model!.id)
      return res.data?.versions?.find((v: ModelVersion) => v.id === job!.modelVersionId) as ModelVersion | undefined
    },
    enabled: !!isCompleted && !!job?.model?.id && !!job?.modelVersionId,
  })
  const modelMetrics = modelVersionData?.metrics

  const handleControl = async (action: 'pause' | 'resume' | 'stop') => {
    setControlLoading(action)
    try {
      await trainingApi.control(jobId!, action)
    } catch {
      toast.error('操作失败，请重试')
    } finally {
      setControlLoading(null)
    }
  }

  if (isLoading && !job) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>
  if (!job) return <div className="py-20 text-center text-muted-foreground">训练任务不存在</div>

  const isRunning = job.status === 'RUNNING'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/training')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{job.model?.name || '训练任务'}</h1>
            <Badge variant={job.status === 'RUNNING' ? 'default' : job.status === 'COMPLETED' ? 'default' : 'secondary'}>
              {statusLabel(job.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{job.model?.baseModel} | {formatDate(job.createdAt)}</p>
        </div>
        <div className="flex gap-2">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={() => handleControl('pause')} disabled={controlLoading !== null}>{controlLoading === 'pause' ? '暂停中...' : (<><Pause className="mr-2 h-4 w-4" />暂停</>)}</Button>
          )}
          {job.status === 'PAUSED' && (
            <Button variant="outline" size="sm" onClick={() => handleControl('resume')} disabled={controlLoading !== null}>{controlLoading === 'resume' ? '继续中...' : (<><Play className="mr-2 h-4 w-4" />继续</>)}</Button>
          )}
          {(isRunning || job.status === 'PAUSED') && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleControl('stop')} disabled={controlLoading !== null}>{controlLoading === 'stop' ? '停止中...' : (<><Square className="mr-2 h-4 w-4" />停止</>)}</Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-end justify-between mb-3">
            <p className="text-sm font-medium">训练进度</p>
            <p className="text-2xl font-semibold">{job.progress}%</p>
          </div>
          <Progress value={job.progress} className="h-3" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Epoch {job.currentEpoch}/{job.totalEpochs}</span>
            <span>GPU: {job.gpuType} x{job.gpuCount}</span>
          </div>
        </CardContent>
      </Card>

      {/* 训练结果自动解读（P1-2） */}
      {isCompleted && modelVersionData?.interpretation && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />训练结果自动解读
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground/90">{modelVersionData.interpretation}</p>
          </CardContent>
        </Card>
      )}

      {/* 训练完成后的模型指标 + 快捷操作 */}
      {isCompleted && modelMetrics && Object.keys(modelMetrics).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />模型指标
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(modelMetrics).map(([key, val]) => {
                const numVal = typeof val === 'number' ? val : parseFloat(String(val))
                const isPct = key.toLowerCase().includes('accuracy') || key.toLowerCase().includes('precision') || key.toLowerCase().includes('recall') || key.toLowerCase().includes('f1')
                const displayPct = isPct && numVal <= 1 ? (numVal * 100).toFixed(1) + '%' : typeof val === 'number' ? val.toFixed(4) : String(val)
                const icon = key.toLowerCase().includes('accuracy') ? <CheckCircle2 className="h-4 w-4 text-green-600" /> :
                  key.toLowerCase().includes('loss') || key.toLowerCase().includes('error') ? <XCircle className="h-4 w-4 text-red-500" /> :
                  <Target className="h-4 w-4 text-muted-foreground" />
                return (
                  <div key={key} className="bg-muted/30 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">{icon}</div>
                    <p className="text-xl font-semibold">{displayPct}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">{key.replace(/_/g, ' ')}</p>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3">
              <Button size="sm" variant="default" onClick={() => navigate(`/app/models/${job?.model?.id}/versions/${job?.modelVersionId}`)}>
                <BarChart3 className="mr-2 h-4 w-4" />查看模型详情
              </Button>
              {job?.model?.baseModel === 'text_classification' && (
                <Button size="sm" variant="outline" onClick={() => navigate('/app/inference')}>
                  <Zap className="mr-2 h-4 w-4" />去推理页测试
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Loss Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Loss 曲线</CardTitle></CardHeader>
          <CardContent>
            {lossData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={lossData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="step" fontSize={12} tickLine={false} />
                  <YAxis fontSize={12} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip />
                  <Line type="monotone" dataKey="loss" stroke="var(--primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-muted-foreground text-sm">等待训练数据...</p>
            )}
          </CardContent>
        </Card>

        {/* Logs */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">训练日志</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {job.logs && job.logs.length > 0 ? (
                <div className="space-y-1 font-mono text-xs">
                  {job.logs.map((log, i) => (
                    <div key={`${log.timestamp}-${i}`} className={`py-0.5 ${log.level === 'ERROR' ? 'text-destructive' : log.level === 'WARN' ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      <span className="text-muted-foreground/60">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                      [{log.level}] {log.message}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-muted-foreground text-sm">等待日志输出...</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
