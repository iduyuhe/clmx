import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { deploymentsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Copy, Key, Send, Trash2 } from 'lucide-react'
import { statusLabel } from '@/lib/formatters'
import type { ApiKey as TApiKey } from '@/types/models'

export function DeploymentDetailPage() {
  const { deploymentId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState('')
  const [showKeyDialog, setShowKeyDialog] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [rateLimit, setRateLimit] = useState('100')
  const [createdKey, setCreatedKey] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['deployment', deploymentId],
    queryFn: () => deploymentsApi.get(deploymentId!),
    enabled: !!deploymentId,
  })

  const deployment = data?.data

  const testMutation = useMutation({
    mutationFn: (input: string) => deploymentsApi.testCall(deploymentId!, input),
    onSuccess: (res) => setTestResult(res.data.output),
    onError: () => toast.error('测试调用失败'),
  })

  const createKeyMutation = useMutation({
    mutationFn: () => deploymentsApi.createApiKey(deploymentId!, { name: keyName, rateLimit: parseInt(rateLimit) }),
    onSuccess: (_res) => {
      queryClient.invalidateQueries({ queryKey: ['deployment', deploymentId] })
      setShowKeyDialog(false)
      setKeyName('')
      setRateLimit('100')
      const key = _res.data.apiKey
      if (key) {
        setCreatedKey(key)
        toast.success('API 密钥已创建')
      }
    },
    onError: () => toast.error('创建密钥失败'),
  })

  const handleCopyKey = (preview: string) => {
    navigator.clipboard.writeText(preview).then(
      () => toast.success('已复制到剪贴板'),
      () => toast.error('复制失败'),
    )
  }

  const handleDeleteKey = (keyId: string) => {
    if (!deploymentId) return
    deploymentsApi.deleteApiKey(deploymentId, keyId).then(
      () => {
        toast.success('密钥已删除')
        queryClient.invalidateQueries({ queryKey: ['deployment', deploymentId] })
      },
      () => toast.error('删除失败'),
    )
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>
  if (isError || !deployment) return <div className="py-20 text-center text-muted-foreground">部署不存在或加载失败</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/deployments')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{deployment.name}</h1>
            <Badge>{statusLabel(deployment.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{deployment.endpointUrl || '端点分配中...'}</p>
        </div>
      </div>

      {createdKey && (
        <Card className="border-green-500/50 bg-green-50/50">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-green-800">API 密钥已创建，请立即保存（仅显示一次）</p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 px-3 py-2 rounded bg-green-100 text-sm font-mono break-all">{createdKey}</code>
              <Button variant="outline" size="sm" onClick={() => handleCopyKey(createdKey)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">在线调用测试</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>输入文本</Label>
              <Textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder="输入测试文本..." rows={4} />
            </div>
            <Button onClick={() => testMutation.mutate(testInput)} disabled={!testInput || testMutation.isPending} className="w-full">
              <Send className="mr-2 h-4 w-4" />{testMutation.isPending ? '发送中...' : '发送测试'}
            </Button>
            {testResult && (
              <div className="bg-muted rounded-lg p-4">
                <p className="text-xs font-medium mb-1 text-muted-foreground">模型输出</p>
                <p className="text-sm whitespace-pre-wrap">{testResult}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">API 密钥</CardTitle>
            <Dialog open={showKeyDialog} onOpenChange={(open) => { setShowKeyDialog(open); if (!open) { setKeyName(''); setRateLimit('100') } }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm"><Key className="mr-2 h-4 w-4" />创建密钥</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>创建 API 密钥</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>密钥名称</Label>
                    <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="例如：生产环境密钥" />
                  </div>
                  <div className="space-y-2">
                    <Label>速率限制 (次/分钟)</Label>
                    <Input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} type="number" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => createKeyMutation.mutate()} disabled={!keyName || createKeyMutation.isPending}>
                    {createKeyMutation.isPending ? '创建中...' : '创建'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {deployment.apiKeys && deployment.apiKeys.length > 0 ? (
              <div className="space-y-2">
                {deployment.apiKeys.map((key: TApiKey) => (
                  <div key={key.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{key.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{key.keyPreview}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={key.isActive ? 'default' : 'secondary'}>{key.isActive ? '活跃' : '禁用'}</Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopyKey(key.keyPreview)}><Copy className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteKey(key.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">暂无 API 密钥</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
