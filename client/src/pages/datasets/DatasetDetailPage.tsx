import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { datasetsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Download, Trash2, MessageSquareText, FileText } from 'lucide-react'
import { formatFileSize, formatDate } from '@/lib/formatters'
import { AnnotationTab } from './AnnotationTab'

export function DatasetDetailPage() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'detail' | 'annotations'>('detail')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => datasetsApi.get(datasetId!),
    enabled: !!datasetId,
  })

  const dataset = data?.data

  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: ['dataset', datasetId, 'preview'],
    queryFn: () => datasetsApi.getPreview(datasetId!),
    enabled: !!datasetId && tab === 'detail',
  })

  const deleteMutation = useMutation({
    mutationFn: () => datasetsApi.remove(datasetId!),
    onSuccess: () => {
      toast.success('数据集已删除')
      queryClient.invalidateQueries({ queryKey: ['datasets'] })
      navigate('/app/datasets')
    },
    onError: () => toast.error('删除失败，请重试'),
  })

  const handleDownload = async () => {
    if (!dataset?.filePath) {
      toast.info('暂无文件可下载')
      return
    }
    try {
      const response = await fetch(`/api/datasets/${datasetId}/download`)
      if (!response.ok) throw new Error('下载失败')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = dataset.name + '.' + (dataset.format || 'csv')
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('文件下载失败')
    }
  }

  const handleDelete = () => {
    if (!datasetId) return
    deleteMutation.mutate()
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>
  if (isError || !dataset) return <div className="py-20 text-center text-muted-foreground">数据集不存在或加载失败</div>

  const preview = previewData?.data
  const previewRows = preview?.preview || []
  const previewHeaders = preview?.headers || (previewRows.length > 0 ? Object.keys(previewRows[0]) : [])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/datasets')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{dataset.name}</h1>
            <Badge>{dataset.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{dataset.description || '无描述'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}><Download className="mr-2 h-4 w-4" />下载</Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
            <Trash2 className="mr-2 h-4 w-4" />{deleteMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">格式</p><p className="font-medium">{dataset.format}</p></CardContent></Card>
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">大小</p><p className="font-medium">{formatFileSize(dataset.fileSize)}</p></CardContent></Card>
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">行数</p><p className="font-medium">{dataset.rowCount?.toLocaleString()}</p></CardContent></Card>
        <Card className="border-0 bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">创建时间</p><p className="font-medium">{formatDate(dataset.createdAt)}</p></CardContent></Card>
      </div>

      {/* 标签页切换 */}
      <div className="flex gap-2">
        <Button variant={tab === 'detail' ? 'default' : 'outline'} size="sm" onClick={() => setTab('detail')}>
          <FileText className="mr-2 h-4 w-4" />详情
        </Button>
        <Button variant={tab === 'annotations' ? 'default' : 'outline'} size="sm" onClick={() => setTab('annotations')}>
          <MessageSquareText className="mr-2 h-4 w-4" />标注
        </Button>
      </div>

      {tab === 'detail' && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">数据预览（{preview?.rowCount?.toLocaleString() || 0} 行）</CardTitle></CardHeader>
          <CardContent className="p-0">
            {previewLoading ? (
              <div className="p-8 text-center text-muted-foreground">加载预览数据...</div>
            ) : previewRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      {previewHeaders.map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {previewRows.slice(0, 20).map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        {previewHeaders.map((h) => (
                          <td key={h} className="px-3 py-2 max-w-xs truncate">{String(row[h as keyof typeof row] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">暂无预览数据</div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'annotations' && (
        <AnnotationTab
          datasetId={datasetId!}
          versionId={dataset.versions?.[0]?.id || ''}
        />
      )}
    </div>
  )
}
