import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { modelsApi, datasetsApi, trainingApi } from '@/api'
import type { ApiResponse } from '@/types/common'
import type { Dataset, TrainingJob, DataVersion } from '@/types/models'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Play, Info } from 'lucide-react'

export function ModelTrainPage() {
  const { modelId } = useParams()
  const navigate = useNavigate()
  const [learningRate, setLearningRate] = useState(2)
  const [epochs, setEpochs] = useState(3)
  const [batchSize, setBatchSize] = useState('8')
  const [datasetId, setDatasetId] = useState('')
  const [datasetVersionId, setDatasetVersionId] = useState('')

  const { data: modelData, isLoading: modelLoading } = useQuery({
    queryKey: ['model', modelId],
    queryFn: () => modelsApi.get(modelId!),
    enabled: !!modelId,
  })

  const { data: dsData } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => datasetsApi.list(),
  })

  const { data: versionsData } = useQuery({
    queryKey: ['dataset-versions', datasetId],
    queryFn: () => datasetsApi.getVersions(datasetId),
    enabled: !!datasetId,
  })

  const model = modelData?.data
  const datasets = dsData?.data || []
  const versions = versionsData?.data || []

  // 根据模型基座类型推断训练范式
  const isTextClassification = model?.baseModel === 'text_classification'

  const handleDatasetChange = (dsId: string) => {
    setDatasetId(dsId)
    setDatasetVersionId('')
  }

  const trainMutation = useMutation({
    mutationFn: () => trainingApi.create({
      modelId: modelId!,
      datasetVersionId,
      hyperparams: {
        ...(isTextClassification ? { modelType: 'text_classification', dataType: 'text' } : {}),
        learningRate: learningRate / 10000,
        epochs,
        batchSize: parseInt(batchSize),
      },
    }),
    onSuccess: (res: ApiResponse<TrainingJob>) => navigate(`/app/training/${res.data.id}`),
    onError: () => toast.error('训练任务创建失败，请重试'),
  })

  if (modelLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>

  const canSubmit = datasetVersionId && !trainMutation.isPending

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/app/models/${modelId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">发起训练</h1>
          <p className="text-sm text-muted-foreground mt-1">{model?.name} | {model?.baseModel}</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">训练配置</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>训练数据集</Label>
            <Select value={datasetId} onValueChange={handleDatasetChange}>
              <SelectTrigger><SelectValue placeholder="选择数据集" /></SelectTrigger>
              <SelectContent>
                {datasets.filter((d: Dataset) => d.status === 'READY').map((ds: Dataset) => (
                  <SelectItem key={ds.id} value={ds.id}>{ds.name} ({ds.rowCount?.toLocaleString()} 条)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {datasetId && (
            <div className="space-y-2">
              <Label>数据版本</Label>
              <Select value={datasetVersionId} onValueChange={setDatasetVersionId} disabled={versions.length === 0}>
                <SelectTrigger><SelectValue placeholder={versions.length > 0 ? '选择版本' : '加载版本中...'} /></SelectTrigger>
                <SelectContent>
                  {versions.map((v: DataVersion) => (
                    <SelectItem key={v.id} value={v.id}>v{v.versionNumber} ({v.rowCount?.toLocaleString()} 条{ v.changeSummary ? ` - ${v.changeSummary}` : ''})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isTextClassification ? (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                中文文本分类采用<strong className="text-foreground">零依赖朴素贝叶斯</strong>训练：纯本地运行、<strong className="text-foreground">不联网</strong>、训练与推理使用同一套分词与算法（训推同构）。
                请选择「JSONL / 文本分类」格式的数据集（如演示的「DEMO-情感分析示例」）。学习率 / 轮次 / 批量大小对本范式无效，无需设置。
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex justify-between"><Label>学习率</Label><span className="text-sm text-muted-foreground">{(learningRate / 10000).toFixed(4)}</span></div>
                <Slider value={[learningRate]} onValueChange={([v]) => setLearningRate(v)} min={1} max={50} step={1} />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between"><Label>训练轮次 (Epochs)</Label><span className="text-sm text-muted-foreground">{epochs}</span></div>
                <Slider value={[epochs]} onValueChange={([v]) => setEpochs(v)} min={1} max={20} step={1} />
              </div>

              <div className="space-y-2">
                <Label>批量大小 (Batch Size)</Label>
                <Select value={batchSize} onValueChange={setBatchSize}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['4', '8', '16', '32', '64'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <Button className="w-full" onClick={() => trainMutation.mutate()} disabled={!canSubmit}>
            <Play className="mr-2 h-4 w-4" />
            {trainMutation.isPending ? '提交中...' : '开始训练'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
