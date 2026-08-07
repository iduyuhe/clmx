import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMutation, useQuery } from '@tanstack/react-query'
import { datasetsApi, industriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { ArrowLeft, Upload } from 'lucide-react'

export function DatasetCreatePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [industry, setIndustry] = useState('')
  const [scenario, setScenario] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [step, setStep] = useState<'info' | 'upload' | 'done'>('info')

  const { data: indData } = useQuery({
    queryKey: ['industries'],
    queryFn: () => industriesApi.list(),
  })
  const industries = indData?.data || []
  const selectedIndustry = industries.find((i) => i.name === industry)

  const createMutation = useMutation({
    mutationFn: () => datasetsApi.create({ name, description, industry, scenario }),
    onSuccess: (res) => {
      if (file) {
        datasetsApi.upload(res.data.id, file, setUploadProgress).then(() => {
          setStep('done')
        }).catch(() => toast.error('文件上传失败'))
      } else {
        setStep('done')
      }
    },
    onError: () => toast.error('创建数据集失败'),
  })

  if (step === 'done') {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-full bg-green-100 p-4 mb-4">
          <Upload className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">数据集创建成功</h2>
        <p className="text-muted-foreground mb-6">数据正在处理中，请稍候查看</p>
        <Button onClick={() => navigate('/app/datasets')}>返回列表</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/datasets')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">创建数据集</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 'info' ? '填写基本信息' : '上传数据文件'}
          </p>
        </div>
      </div>

      {step === 'info' && (
        <Card>
          <CardHeader><CardTitle className="text-base">基本信息</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：制造业问答数据集" />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="数据集用途和内容说明" rows={3} />
            </div>
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
                <Select value={scenario} onValueChange={setScenario}>
                  <SelectTrigger><SelectValue placeholder="选择场景" /></SelectTrigger>
                  <SelectContent>
                    {selectedIndustry?.scenarios?.map((sc) => (
                      <SelectItem key={sc.id} value={sc.name}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={() => setStep('upload')} disabled={!name}>
              下一步：上传数据
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'upload' && (
        <Card>
          <CardHeader><CardTitle className="text-base">上传文件</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
              <Input
                type="file"
                accept=".csv,.json,.jsonl,.txt"
                className="hidden"
                id="file-upload"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium">{file ? file.name : '点击选择文件'}</p>
                <p className="text-xs text-muted-foreground mt-1">支持 CSV、JSON、JSONL、TXT 格式</p>
              </label>
            </div>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('info')}>上一步</Button>
              <Button className="flex-1" onClick={() => createMutation.mutate()} disabled={!file || createMutation.isPending}>
                {createMutation.isPending ? '创建中...' : '创建数据集'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
