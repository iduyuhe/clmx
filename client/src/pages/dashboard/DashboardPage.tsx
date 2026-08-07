import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Brain, FlaskConical, Rocket, Activity, Plus, Upload, ArrowRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { TrainingJob } from '@/types/models'

export function DashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.getStats(),
  })

  const stats = data?.data

  const statCards = [
    { label: '模型总数', value: stats?.modelCount ?? 0, icon: Brain, color: 'text-blue-600', bg: 'bg-blue-50', to: '/app/models' },
    { label: '训练中', value: stats?.trainingCount ?? 0, icon: FlaskConical, color: 'text-amber-600', bg: 'bg-amber-50', to: '/app/training' },
    { label: '已部署', value: stats?.deployedCount ?? 0, icon: Rocket, color: 'text-green-600', bg: 'bg-green-50', to: '/app/deployments' },
    { label: '今日API调用', value: stats?.todayApiCalls ?? 0, icon: Activity, color: 'text-purple-600', bg: 'bg-purple-50', to: null },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">工作台</h1>
        <p className="text-sm text-muted-foreground mt-1">垂类大模型训练平台概览</p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => navigate('/app/models/new')} size="sm">
          <Plus className="mr-2 h-4 w-4" /> 创建模型
        </Button>
        <Button variant="outline" onClick={() => navigate('/app/datasets/new')} size="sm">
          <Upload className="mr-2 h-4 w-4" /> 上传数据
        </Button>
        <Button variant="outline" onClick={() => navigate('/app/deployments')} size="sm">
          <Rocket className="mr-2 h-4 w-4" /> 查看部署
        </Button>
      </div>

      {isError ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">数据加载失败</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>
          </CardContent>
        </Card>
      ) : (
        <>
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <Card
            key={s.label}
            className={`border-0 bg-muted/30 ${s.to ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
            onClick={() => { if (s.to) navigate(s.to) }}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`p-2.5 rounded-lg ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="text-2xl font-semibold">{s.value}</p>
                )}
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* API Call Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">API 调用趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={stats?.apiCallTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" fontSize={12} tickLine={false} />
                  <YAxis fontSize={12} tickLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" stroke="var(--primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent Training */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">最近训练</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/training')}>
              查看全部 <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full mb-2" />)
            ) : stats?.recentTrainingJobs?.length ? (
              <div className="space-y-2">
                {stats.recentTrainingJobs.slice(0, 5).map((job: TrainingJob) => (
                  <div key={job.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{job.model?.name || job.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {job.currentEpoch}/{job.totalEpochs} epoch
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                      {job.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <Empty className="py-4"><EmptyDescription>暂无训练任务</EmptyDescription></Empty>
            )}
          </CardContent>
        </Card>
      </div>
        </>
      )}
    </div>
  )
}
