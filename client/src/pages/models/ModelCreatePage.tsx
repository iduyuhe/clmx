import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMutation, useQuery } from '@tanstack/react-query'
import { modelsApi, industriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { ArrowLeft, Check } from 'lucide-react'

const baseModels = [
  { value: 'QWEN2.5-7B', label: 'Qwen2.5-7B', desc: '轻量级，适合快速实验和中小规模数据' },
  { value: 'QWEN2.5-14B', label: 'Qwen2.5-14B', desc: '均衡性能，中文能力强' },
  { value: 'QWEN2.5-72B', label: 'Qwen2.5-72B', desc: '旗舰性能，适合复杂任务' },
  { value: 'DEEPSEEK-V2', label: 'DeepSeek-V2', desc: '高性价比推理，训练成本低' },
  { value: 'DEEPSEEK-CODER', label: 'DeepSeek-Coder', desc: '代码生成场景优化' },
  { value: 'text_classification', label: '中文文本分类 (NLP)', desc: '零依赖朴素贝叶斯，纯本地训练与推理，不联网，适合情感分析/工单分类等场景' },
]

export function ModelCreatePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [industry, setIndustry] = useState('')
  const [scenario, setScenario] = useState('')
  const [baseModel, setBaseModel] = useState('')

  const { data: indData } = useQuery({
    queryKey: ['industries'],
    queryFn: () => industriesApi.list(),
  })
  const industries = indData?.data || []
  const selectedIndustry = industries.find((i) => i.name === industry)

  const createMutation = useMutation({
    mutationFn: () => modelsApi.create({ name, description, industry, scenario, baseModel }),
    onSuccess: (res) => navigate(`/app/models/${res.data.id}`),
    onError: () => toast.error('创建模型失败'),
  })

  const steps = ['选择行业场景', '选择基座模型', '确认信息']

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/models')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">创建模型</h1>
          <p className="text-sm text-muted-foreground mt-1">按向导逐步配置行业、场景和基座模型</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${
              i <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5 text-center text-xs">{i + 1}</span>}
              {s}
            </div>
            {i < steps.length - 1 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">选择行业与场景</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>行业</Label>
                <Select value={industry} onValueChange={setIndustry}>
                  <SelectTrigger><SelectValue placeholder="选择行业" /></SelectTrigger>
                  <SelectContent>
                    {industries.map((ind) => <SelectItem key={ind.id} value={ind.name}>{ind.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>场景</Label>
                <Select value={scenario} onValueChange={setScenario} disabled={!industry}>
                  <SelectTrigger><SelectValue placeholder="选择场景" /></SelectTrigger>
                  <SelectContent>
                    {selectedIndustry?.scenarios?.map((sc) => (
                      <SelectItem key={sc.id} value={sc.name}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={() => setStep(1)} disabled={!industry || !scenario}>
              下一步
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">选择基座模型</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {baseModels.map((bm) => (
              <div
                key={bm.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  baseModel === bm.value ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
                }`}
                onClick={() => setBaseModel(bm.value)}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  baseModel === bm.value ? 'border-primary' : 'border-muted-foreground'
                }`}>
                  {baseModel === bm.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <div>
                  <p className="font-medium text-sm">{bm.label}</p>
                  <p className="text-xs text-muted-foreground">{bm.desc}</p>
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(0)}>上一步</Button>
              <Button className="flex-1" onClick={() => setStep(2)} disabled={!baseModel}>下一步</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle className="text-base">确认模型信息</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">行业：</span><span className="font-medium">{industry}</span>
                <span className="text-muted-foreground">场景：</span><span className="font-medium">{scenario}</span>
                <span className="text-muted-foreground">基座模型：</span><span className="font-medium">{baseModel}</span>
              </div>
              <div className="space-y-2 pt-2">
                <Label>模型名称</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：制造业智能问答V1" />
              </div>
              <div className="space-y-2">
                <Label>描述</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="模型用途说明" rows={3} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>上一步</Button>
              <Button className="flex-1" onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending}>
                {createMutation.isPending ? '创建中...' : '创建模型'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
