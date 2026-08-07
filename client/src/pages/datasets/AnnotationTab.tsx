import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { datasetsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle, Circle, XCircle, Edit3, Plus, ChevronLeft, ChevronRight, Database } from 'lucide-react'
import type { Annotation } from '@/types/models'

interface AnnotationTabProps {
  datasetId: string
  versionId: string
}

export function AnnotationTab({ datasetId, versionId }: AnnotationTabProps) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [editingRow, setEditingRow] = useState<{ dataIndex: number; rowData?: Record<string, unknown>; annotation?: Annotation } | null>(null)
  const pageSize = 20

  // 数据预览
  const { data: previewData } = useQuery({
    queryKey: ['dataset', 'preview', datasetId],
    queryFn: () => datasetsApi.getPreview(datasetId),
    enabled: !!datasetId,
  })
  const preview = previewData?.data?.preview || []

  // 标注进度汇总
  const { data: summaryData } = useQuery({
    queryKey: ['annotations', 'summary', datasetId, versionId],
    queryFn: () => datasetsApi.getAnnotationSummary(datasetId, versionId),
    enabled: !!versionId,
  })
  const summary = summaryData?.data

  // 标注列表
  const { data, isLoading } = useQuery({
    queryKey: ['annotations', datasetId, versionId, page, statusFilter],
    queryFn: () => datasetsApi.getAnnotations(datasetId, versionId, { page, pageSize, status: statusFilter }),
    enabled: !!versionId,
  })

  const annotations = data?.data || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1

  const saveMutation = useMutation({
    mutationFn: (req: { dataIndex: number; annotationType: string; annotationData: Record<string, unknown> }) =>
      datasetsApi.createAnnotation(datasetId, { versionId, ...req }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] })
      setEditingRow(null)
      toast.success('标注已保存')
    },
    onError: () => toast.error('保存失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) => datasetsApi.deleteAnnotation(datasetId, annotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] })
      toast.success('标注已删除')
    },
    onError: () => toast.error('删除失败'),
  })

  const pct = summary && summary.totalRows > 0 ? Math.round((summary.completed / summary.totalRows) * 100) : 0

  // 获取某行的数据
  const getRowData = (dataIndex: number) => {
    if (preview.length > 0 && dataIndex < preview.length) return preview[dataIndex]
    return undefined
  }

  return (
    <div className="space-y-4">
      {/* 标注进度 */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">标注进度</CardTitle>
          <span className="text-xs text-muted-foreground">基于数据版本 v1</span>
        </CardHeader>
        <CardContent>
          {!summary ? (
            <Skeleton className="h-8" />
          ) : summary.totalRows === 0 ? (
            <p className="text-sm text-muted-foreground">数据集尚未上传文件，无法标注</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1"><CheckCircle className="h-4 w-4 text-green-600" />已完成 {summary.completed}</span>
                <span className="flex items-center gap-1"><Circle className="h-4 w-4 text-amber-600" />待标注 {summary.pending}</span>
                <span className="flex items-center gap-1"><XCircle className="h-4 w-4 text-red-600" />已拒绝 {summary.rejected}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{pct}% 完成（{summary.completed}/{summary.totalRows}）</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 标注列表 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">标注列表</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
                <SelectTrigger className="w-24 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部</SelectItem>
                  <SelectItem value="COMPLETED">已完成</SelectItem>
                  <SelectItem value="PENDING">待标注</SelectItem>
                  <SelectItem value="REJECTED">已拒绝</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingRow({ dataIndex: annotations.length > 0 ? Math.max(...annotations.map(a => a.dataIndex)) + 1 : 0 })}>
                <Plus className="mr-1 h-3 w-3" />标注新行
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : annotations.length === 0 ? (
            <div className="py-8 text-center">
              <Database className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">暂未开始标注</p>
              <p className="text-xs text-muted-foreground mt-1">数据集上传文件后即可逐行标注</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {annotations.map((a) => {
                const rowData = getRowData(a.dataIndex)
                return (
                  <div key={a.id} className="py-2 px-3 rounded bg-muted/50 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground shrink-0">行 #{a.dataIndex + 1}</span>
                        <Badge variant="outline" className="text-xs shrink-0">{a.annotationType}</Badge>
                        <span className="text-xs truncate max-w-[220px]">
                          {typeof a.annotationData === 'object' ? (
                            (a.annotationData as { label?: string }).label || JSON.stringify(a.annotationData).slice(0, 40)
                          ) : String(a.annotationData).slice(0, 40)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {a.status === 'COMPLETED' && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
                        {a.status === 'PENDING' && <Circle className="h-3.5 w-3.5 text-amber-600" />}
                        {a.status === 'REJECTED' && <XCircle className="h-3.5 w-3.5 text-red-600" />}
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingRow({ dataIndex: a.dataIndex, rowData, annotation: a })}>
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => {
                          if (confirm('确定删除此标注？')) deleteMutation.mutate(a.id)
                        }}>
                          <XCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {rowData && (
                      <div className="mt-1 pl-14">
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          数据: {JSON.stringify(rowData).slice(0, 120)}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-muted-foreground">共 {total} 条</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-3 w-3" />上一页
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  下一页<ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑标注对话框 */}
      <AnnotationEditDialog
        open={!!editingRow}
        onClose={() => setEditingRow(null)}
        annotation={editingRow?.annotation}
        dataIndex={editingRow?.dataIndex ?? 0}
        rowData={editingRow?.rowData}
        preview={preview}
        onSave={(data) => saveMutation.mutate(data)}
        loading={saveMutation.isPending}
      />
    </div>
  )
}

function AnnotationEditDialog({
  open, onClose, annotation, dataIndex, rowData, preview, onSave, loading,
}: {
  open: boolean
  onClose: () => void
  annotation?: Annotation
  dataIndex: number
  rowData?: Record<string, unknown>
  preview: Record<string, unknown>[]
  onSave: (data: { dataIndex: number; annotationType: string; annotationData: Record<string, unknown> }) => void
  loading: boolean
}) {
  const data = rowData || (preview.length > 0 && dataIndex < preview.length ? preview[dataIndex] : undefined)
  const [aType, setAType] = useState(annotation?.annotationType || 'classification')
  const [label, setLabel] = useState((annotation?.annotationData as { label?: string })?.label || '')
  const [comment, setComment] = useState((annotation?.annotationData as { comment?: string })?.comment || '')

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{annotation ? '编辑标注' : '新建标注'} — 行 #{dataIndex + 1}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => {
          e.preventDefault()
          onSave({
            dataIndex,
            annotationType: aType,
            annotationData: { label, comment },
          })
        }} className="space-y-4">
          {/* 数据行预览 */}
          {data && (
            <div className="p-3 rounded bg-blue-50 text-xs border border-blue-100">
              <p className="font-medium text-blue-800 mb-1">原始数据 (行 #{dataIndex + 1})</p>
              {Object.entries(data).map(([k, v]) => (
                <p key={k} className="text-blue-700">
                  <span className="font-mono text-blue-500">{k}:</span> {String(v).slice(0, 200)}
                </p>
              ))}
            </div>
          )}

          <div>
            <Label>标注类型</Label>
            <Select value={aType} onValueChange={setAType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="classification">文本分类</SelectItem>
                <SelectItem value="sentiment">情感分析</SelectItem>
                <SelectItem value="ner">命名实体识别</SelectItem>
                <SelectItem value="qa">问答对</SelectItem>
                <SelectItem value="summary">摘要</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>标签</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="如：正面/负面、体育/财经..." />
          </div>
          <div>
            <Label>备注</Label>
            <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="标注备注..." rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>{loading ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
