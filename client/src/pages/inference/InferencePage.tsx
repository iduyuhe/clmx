import { useState, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { inferenceApi } from '@/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Play, Zap, Cpu, Bot, Database, Info, Upload } from 'lucide-react'

const TASK_LABELS: Record<string, string> = {
  text_classification: '文本分类',
  ner: '命名实体识别',
  sentiment_analysis: '情感分析',
  summarization: '文本摘要',
  keywords: '关键词提取 ✨',
  text_similarity: '文本相似度 ✨',
  text_clustering: '文本聚类 ✨',
}

type Source = 'pretrained' | 'mymodel'

export function InferencePage() {
  const [source, setSource] = useState<Source>('pretrained')
  const [task, setTask] = useState('text_classification')
  const [texts, setTexts] = useState('')
  const [modelVersionId, setModelVersionId] = useState('')
  const [threshold, setThreshold] = useState(0)

  const [pretrainResults, setPretrainResults] = useState<{ label: string; score?: number }[] | string[] | null>(null)
  const [myResults, setMyResults] = useState<{
    modelVersionId: string
    labels: string[]
    results: { text: string; label: string; labels: string[]; scores: Record<string, number>; probabilities: Record<string, number> }[]
    latencyMs: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      const lines = content.split('\n').filter(Boolean)
      const isCsv = lines.length > 1 && lines[0].includes(',')
      if (isCsv) {
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
        const textIdx = headers.findIndex(h => h === 'text' || h === 'content' || h === '评论' || h === '内容')
        if (textIdx >= 0) {
          const texts = lines.slice(1).map(line => {
            const cols = line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'))
            return cols[textIdx] || ''
          }).filter(Boolean)
          setTexts(texts.join('\n'))
          toast.success(`已导入 ${texts.length} 条文本`)
        } else {
          setTexts(lines.slice(1).join('\n'))
          toast.success(`已导入 ${lines.length - 1} 条文本`)
        }
      } else {
        setTexts(lines.join('\n'))
        toast.success(`已导入 ${lines.length} 条文本`)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const { data: availableModels, isLoading: modelsLoading } = useQuery({
    queryKey: ['inference-models'],
    queryFn: () => inferenceApi.models(),
    enabled: source === 'pretrained',
  })

  const { data: myModels, isLoading: myModelsLoading } = useQuery({
    queryKey: ['inference-text-models'],
    queryFn: () => inferenceApi.textClassificationModels(),
    enabled: source === 'mymodel',
  })

  const predictMutation = useMutation({
    mutationFn: () => {
      const textList = texts.split('\n').filter(Boolean)
      // 关键词提取和文本相似度走专用 API（零依赖纯 JS）
      if (task === 'keywords') {
        return inferenceApi.keywords({ texts: textList.length <= 1 ? texts : textList, topN: 8 })
      }
      if (task === 'text_similarity') {
        if (textList.length < 2) return Promise.reject({ response: { data: { message: '文本相似度需要至少输入两段文本（每行一段）' } } })
        return inferenceApi.textSimilarity({ text1: textList[0], text2: textList.slice(1).join('\n') })
      }
      if (task === 'text_clustering') {
        if (textList.length < 2) return Promise.reject({ response: { data: { message: '文本聚类需要至少2段文本' } } })
        return inferenceApi.textClustering({ texts: textList, nClusters: Math.min(textList.length, 3) })
      }
      return inferenceApi.predict({ task, texts: textList.length <= 1 ? texts : textList })
    },
    onSuccess: (res: any) => {
      if (!res.success && !res.data) return
      const d = res.data || res
      if (task === 'keywords') {
        // 将关键词结果格式化为 {label, score} 数组展示
        const formatted = d.results.flatMap((r: any) => r.keywords.map((kw: any) => ({ label: kw.word, score: kw.score })))
        setPretrainResults(formatted)
      } else if (task === 'text_similarity') {
        setPretrainResults([{ label: `相似度: ${(d.similarity * 100).toFixed(1)}%`, score: d.similarity }])
      } else if (task === 'text_clustering') {
        // 聚类结果：每类显示文档编号和关键词
        const items: { label: string; score?: number }[] = d.keywords?.flatMap((k: any) => [
          { label: `── 聚类 ${k.cluster + 1} ──` },
          ...k.words.map((w: any) => ({ label: `  ${w.word}`, score: w.score })),
        ]) || []
        setPretrainResults(items)
      } else {
        setPretrainResults(d.results as typeof pretrainResults)
      }
      toast.success(`完成 (${d.latencyMs || 0}ms)`)
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || '推理失败')
    },
  })

  const classifyMutation = useMutation({
    mutationFn: () => {
      const textList = texts.split('\n').filter(Boolean)
      return inferenceApi.textClassification({ modelVersionId, texts: textList.length <= 1 ? texts : textList, threshold: threshold > 0 ? threshold : undefined })
    },
    onSuccess: (res) => {
      if (res.success && res.data) {
        setMyResults(res.data)
        toast.success(`推理完成 (${res.data.latencyMs}ms)`)
      }
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || '推理失败')
    },
  })

  const switchSource = (s: Source) => {
    setSource(s)
    setPretrainResults(null)
    setMyResults(null)
  }

  const myModelList = myModels?.data || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">模型推理</h1>
          <p className="text-muted-foreground text-sm mt-1">本地运行模型推理任务</p>
        </div>
      </div>

      {/* 模型来源切换 */}
      <div className="flex gap-2 p-1 bg-muted/50 rounded-lg w-fit">
        <button
          onClick={() => switchSource('pretrained')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            source === 'pretrained' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Zap className="h-4 w-4" /> 预训练模型
        </button>
        <button
          onClick={() => switchSource('mymodel')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            source === 'mymodel' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bot className="h-4 w-4" /> 我的训练模型
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {source === 'pretrained' ? <Zap className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              推理参数
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {source === 'pretrained' ? (
              <div className="space-y-2">
                <Label>任务类型</Label>
                <Select value={task} onValueChange={(v) => { setTask(v); setPretrainResults(null) }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>选择训练好的模型版本</Label>
                {myModelsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : myModelList.length === 0 ? (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>暂无已训练的中文文本分类模型。请先「创建模型」选择「中文文本分类 (NLP)」基座，再在「模型训练」中用文本数据集训练，或使用演示数据生成器一键灌入演示模型。</span>
                  </div>
                ) : (
                  <Select value={modelVersionId} onValueChange={(v) => { setModelVersionId(v); setMyResults(null) }}>
                    <SelectTrigger><SelectValue placeholder="选择模型版本" /></SelectTrigger>
                    <SelectContent>
                      {myModelList.map((m) => (
                        <SelectItem key={m.modelVersionId} value={m.modelVersionId}>
                          {m.modelName} · v{m.versionNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {source === 'mymodel' && modelVersionId && (
              <div className="space-y-2">
                <Label>多标签阈值（可选）</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={threshold * 100}
                    onChange={(e) => setThreshold(parseInt(e.target.value) / 100)}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12 text-right">{threshold.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  设为 0 时取最高概率标签（单标签）{threshold > 0 ? `；概率 ≥ ${(threshold * 100).toFixed(0)}% 的标签全部返回` : ''}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>输入文本（每行一条）</Label>
              <Textarea
                placeholder="请输入需要推理的文本..."
                rows={6}
                value={texts}
                onChange={(e) => setTexts(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />从文件导入
                </Button>
                <span className="text-xs text-muted-foreground">支持 CSV（含 text/content/评论 列）或纯文本文件</span>
              </div>
            </div>

            {source === 'pretrained' ? (
              <Button
                className="w-full"
                onClick={() => predictMutation.mutate()}
                disabled={predictMutation.isPending || !texts.trim()}
              >
                {predictMutation.isPending ? <>推理中...</> : <><Play className="mr-2 h-4 w-4" /> 开始推理</>}
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={() => classifyMutation.mutate()}
                disabled={classifyMutation.isPending || !texts.trim() || !modelVersionId}
              >
                {classifyMutation.isPending ? <>推理中...</> : <><Play className="mr-2 h-4 w-4" /> 开始分类</>}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              推理结果
            </CardTitle>
          </CardHeader>
          <CardContent>
            {source === 'pretrained' ? (
              predictMutation.isPending ? (
                <Skeleton className="h-48 w-full" />
              ) : pretrainResults && pretrainResults.length > 0 ? (
                <div className="space-y-3">
                  {pretrainResults.map((item, i) => {
                    if (typeof item === 'string') {
                      return (
                        <div key={i} className="p-3 rounded-lg bg-muted/50">
                          <p className="text-sm font-mono">{item}</p>
                        </div>
                      )
                    }
                    return (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm font-medium">{item.label}</span>
                        {item.score !== undefined && (
                          <Badge variant="secondary">{(item.score * 100).toFixed(1)}%</Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm">
                  <Zap className="h-8 w-8 mb-2 opacity-30" />
                  输入文本并点击"开始推理"查看结果
                </div>
              )
            ) : (
              classifyMutation.isPending ? (
                <Skeleton className="h-48 w-full" />
              ) : myResults && myResults.results.length > 0 ? (
                <div className="space-y-4">
                  {myResults.results.map((r, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <p className="text-sm text-muted-foreground line-clamp-2">{r.text}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default">{r.label}</Badge>
                        {r.labels && r.labels.length > 1 && r.labels.filter(l => l !== r.label).map(l => (
                          <Badge key={l} variant="outline" className="text-xs">{l}</Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        {myResults.labels.map((l) => (
                          <div key={l} className="flex-1 space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{l}</span>
                              <span>{((r.probabilities[l] || 0) * 100).toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-background overflow-hidden">
                              <div
                                className={`h-full ${r.labels?.includes(l) && r.labels.length > 1 ? 'bg-green-500' : 'bg-primary'}`}
                                style={{ width: `${((r.probabilities[l] || 0) * 100).toFixed(1)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm">
                  <Bot className="h-8 w-8 mb-2 opacity-30" />
                  选择训练好的模型并输入文本，点击"开始分类"查看结果
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {source === 'pretrained' && modelsLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : source === 'pretrained' && availableModels?.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">可用模型</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {availableModels.data.map((m) => (
                <Badge key={`${m.task}-${m.model}`} variant="outline" className="text-xs">
                  {TASK_LABELS[m.task] || m.task}: {m.model}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {source === 'mymodel' && myModelList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" /> 我的中文文本分类模型
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {myModelList.map((m) => (
                <Badge key={m.modelVersionId} variant="outline" className="text-xs">
                  {m.modelName} · v{m.versionNumber} ({m.status})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
