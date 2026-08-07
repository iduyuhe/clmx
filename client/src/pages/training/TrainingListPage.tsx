import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trainingApi } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { SearchFilterBar } from '@/components/SearchFilterBar'
import { FlaskConical, ArrowRight } from 'lucide-react'
import { formatDate, statusLabel } from '@/lib/formatters'

export function TrainingListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['training'],
    queryFn: () => trainingApi.list(),
  })

  const allJobs = data?.data || []
  const jobs = allJobs.filter((job) => {
    const matchSearch = !search || job.model?.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || job.status === statusFilter
    return matchSearch && matchStatus
  })

  const statusVariant = (s: string) => {
    switch (s) { case 'COMPLETED': return 'default'; case 'RUNNING': return 'secondary'; case 'FAILED': return 'destructive'; case 'CANCELLED': return 'outline'; default: return 'secondary' }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">训练任务</h1>
        <p className="text-sm text-muted-foreground mt-1">监控和管理模型训练任务</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <SearchFilterBar
            searchValue={search}
            onSearchChange={v => setSearch(v)}
            searchPlaceholder="搜索模型名称..."
            filterValue={statusFilter}
            onFilterChange={setStatusFilter}
            filterOptions={[
              { value: 'PENDING', label: '等待中' },
              { value: 'RUNNING', label: '运行中' },
              { value: 'COMPLETED', label: '已完成' },
              { value: 'FAILED', label: '失败' },
              { value: 'CANCELLED', label: '已取消' },
            ]}
            filterLabel="全部状态"
          />
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>进度</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>Epoch</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-muted-foreground">数据加载失败</p>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>
                  </div>
                </TableCell></TableRow>
              ) : isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : jobs.length === 0 && (search || statusFilter) ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  没有匹配的训练任务
                </TableCell></TableRow>
              ) : jobs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-40" />暂无训练任务
                </TableCell></TableRow>
              ) : (
                jobs.map((job) => (
                  <TableRow key={job.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/app/training/${job.id}`)}>
                    <TableCell className="font-medium">{job.model?.name || job.id}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 max-w-32">
                        <Progress value={job.progress} className="h-2" />
                        <span className="text-xs text-muted-foreground">{job.progress}%</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge></TableCell>
                    <TableCell className="text-sm">{job.currentEpoch}/{job.totalEpochs}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(job.createdAt)}</TableCell>
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
