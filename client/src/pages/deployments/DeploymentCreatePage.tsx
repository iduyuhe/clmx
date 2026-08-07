import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMutation, useQuery } from '@tanstack/react-query'
import { modelsApi, deploymentsApi } from '@/api'
import type { AiModel, ModelVersion } from '@/types/models'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { ArrowLeft, Rocket } from 'lucide-react'

export function DeploymentCreatePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [modelVersionId, setModelVersionId] = useState('')

  const { data: modelsData } = useQuery({
    queryKey: ['models'],
    queryFn: () => modelsApi.list(),
  })

  const models = modelsData?.data || []
  const trainedModels = models.filter((m: AiModel) => m.status === 'TRAINED' && m.versions && m.versions.length > 0)

  const deployMutation = useMutation({
    mutationFn: () => deploymentsApi.create({ modelVersionId, name }),
    onSuccess: (res) => navigate(`/app/deployments/${res.data.id}`),
    onError: () => toast.error('部署失败'),
  })

  const selectedModel = trainedModels.find((m: AiModel) => m.versions?.some((v: ModelVersion) => v.id === modelVersionId))

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/deployments')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">新建部署</h1>
          <p className="text-sm text-muted-foreground mt-1">将训练好的模型发布为 API 服务</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">部署配置</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>部署名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：制造业问答API V1" />
          </div>
          <div className="space-y-2">
            <Label>选择模型</Label>
            <Select value={modelVersionId} onValueChange={setModelVersionId}>
              <SelectTrigger><SelectValue placeholder="选择已训练的模型版本" /></SelectTrigger>
              <SelectContent>
                {trainedModels.flatMap((m) =>
                  (m.versions || []).map((v: ModelVersion) => (
                    <SelectItem key={v.id} value={v.id}>{m.name} - v{v.versionNumber}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          {selectedModel && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p>基座模型: <span className="font-medium">{selectedModel.baseModel}</span></p>
              <p>行业/场景: <span className="font-medium">{selectedModel.industry} / {selectedModel.scenario}</span></p>
            </div>
          )}
          <Button className="w-full" onClick={() => deployMutation.mutate()} disabled={!name || !modelVersionId || deployMutation.isPending}>
            <Rocket className="mr-2 h-4 w-4" />
            {deployMutation.isPending ? '部署中...' : '一键部署'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
