import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deploymentsApi } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { SearchFilterBar } from '@/components/SearchFilterBar'
import { Rocket, ArrowRight } from 'lucide-react'
import { formatDate, statusLabel } from '@/lib/formatters'

export function DeploymentListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsApi.list(),
  })

  const allDeployments = data?.data || []
  const deployments = allDeployments.filter((d) => {
    const matchSearch = !search || d.name?.toLowerCase().includes(search.toLowerCase())
      || d.endpointUrl?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || d.status === statusFilter
    return matchSearch && matchStatus
  })

  const statusVariant = (s: string) => {
    switch (s) { case 'RUNNING': return 'default'; case 'STOPPED': return 'secondary'; case 'FAILED': return 'destructive'; default: return 'secondary' }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">部署管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理已训练模型的 API 部署</p>
        </div>
        <Button onClick={() => navigate('/app/deployments/new')} size="sm">
          <Rocket className="mr-2 h-4 w-4" /> 新建部署
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <SearchFilterBar
            searchValue={search}
            onSearchChange={v => setSearch(v)}
            searchPlaceholder="搜索名称、端点 URL..."
            filterValue={statusFilter}
            onFilterChange={setStatusFilter}
            filterOptions={[
              { value: 'RUNNING', label: '运行中' },
              { value: 'STOPPED', label: '已停止' },
              { value: 'FAILED', label: '失败' },
            ]}
            filterLabel="全部状态"
          />
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>端点</TableHead>
                <TableHead>实例</TableHead>
                <TableHead>状态</TableHead>
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
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : deployments.length === 0 && (search || statusFilter) ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  没有匹配的部署
                </TableCell></TableRow>
              ) : deployments.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Rocket className="h-8 w-8 mx-auto mb-2 opacity-40" />暂无部署，训练完成后方可部署
                </TableCell></TableRow>
              ) : (
                deployments.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/app/deployments/${d.id}`)}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">{d.endpointUrl || '-'}</TableCell>
                    <TableCell className="text-sm">{d.instanceCount}</TableCell>
                    <TableCell><Badge variant={statusVariant(d.status)}>{statusLabel(d.status)}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(d.createdAt)}</TableCell>
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
