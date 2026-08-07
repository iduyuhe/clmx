import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { datasetsApi } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { SearchFilterBar } from '@/components/SearchFilterBar'
import { Plus, Database, ArrowRight } from 'lucide-react'
import { formatFileSize, formatDate } from '@/lib/formatters'

export function DatasetListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => datasetsApi.list(),
  })

  const allDatasets = data?.data || []
  const datasets = allDatasets.filter((ds) => {
    const matchSearch = !search || ds.name?.toLowerCase().includes(search.toLowerCase())
      || ds.industry?.toLowerCase().includes(search.toLowerCase())
      || ds.format?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || ds.status === statusFilter
    return matchSearch && matchStatus
  })

  const statusVariant = (s: string) => {
    switch (s) {
      case 'READY': return 'default'
      case 'PROCESSING': case 'UPLOADING': return 'secondary'
      case 'ERROR': return 'destructive'
      default: return 'outline'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">数据管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理训练数据集，支持 CSV、JSON、JSONL 格式</p>
        </div>
        <Button onClick={() => navigate('/app/datasets/new')} size="sm">
          <Plus className="mr-2 h-4 w-4" /> 创建数据集
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <SearchFilterBar
            searchValue={search}
            onSearchChange={v => setSearch(v)}
            searchPlaceholder="搜索名称、行业、格式..."
            filterValue={statusFilter}
            onFilterChange={setStatusFilter}
            filterOptions={[
              { value: 'UPLOADING', label: '上传中' },
              { value: 'PROCESSING', label: '处理中' },
              { value: 'READY', label: '就绪' },
              { value: 'ERROR', label: '错误' },
            ]}
            filterLabel="全部状态"
          />
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>行业</TableHead>
                <TableHead>格式</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-muted-foreground">数据加载失败</p>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>
                  </div>
                </TableCell></TableRow>
              ) : isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : datasets.length === 0 && (search || statusFilter) ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  没有匹配的数据集
                </TableCell></TableRow>
              ) : datasets.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  暂无数据集，点击创建第一个
                </TableCell></TableRow>
              ) : (
                datasets.map((ds) => (
                  <TableRow key={ds.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/app/datasets/${ds.id}`)}>
                    <TableCell className="font-medium">{ds.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{ds.industry || '-'}</TableCell>
                    <TableCell className="text-sm">{ds.format}</TableCell>
                    <TableCell className="text-sm">{formatFileSize(ds.fileSize)}</TableCell>
                    <TableCell><Badge variant={statusVariant(ds.status)}>{ds.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(ds.createdAt)}</TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="h-7 w-7"><ArrowRight className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
