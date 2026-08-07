import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { industriesApi } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { Industry, Scenario } from '@/types/models'
import {
  Factory, Stethoscope, Banknote, ShoppingBag, Globe, Brain, FileText, BookOpen, FileBarChart,
  Plus, RefreshCw, Boxes, Sparkles
} from 'lucide-react'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  factory: Factory, stethoscope: Stethoscope, banknote: Banknote,
  'shopping-bag': ShoppingBag, globe: Globe,
}

const scenarioIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  qa: Brain, doc: FileText, kb: BookOpen, report: FileBarChart,
}

export function IndustryListPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['industries'],
    queryFn: () => industriesApi.list(),
  })

  const industries = data?.data || []

  const handleIndustryClick = (industry: Industry) => {
    // 选择行业后跳转到模型创建页，预填行业
    toast.success(`已选择行业: ${industry.name}`)
    navigate(`/app/models/new?industry=${industry.code}`)
  }

  const handleScenarioClick = (e: React.MouseEvent, scenario: Scenario) => {
    e.stopPropagation()
    toast.success(`已选择场景: ${scenario.name}`)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">行业与场景</h1>
          <p className="text-sm text-muted-foreground mt-1">选择行业和场景，平台将推荐最佳模型参数</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">行业与场景</h1>
          <p className="text-sm text-muted-foreground mt-1">选择行业和场景，平台将推荐最佳模型参数</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-muted-foreground">加载失败，请重试</p>
          <Button variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />重试</Button>
        </div>
      </div>
    )
  }

  if (!industries.length) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">行业与场景</h1>
          <p className="text-sm text-muted-foreground mt-1">选择行业和场景，平台将推荐最佳模型参数</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Boxes className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">暂无行业数据</p>
          <p className="text-xs text-muted-foreground">请联系管理员配置行业场景</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">行业与场景</h1>
          <p className="text-sm text-muted-foreground mt-1">选择行业和场景，平台将推荐最佳模型参数</p>
        </div>
        <Button onClick={() => navigate('/app/models/new')}><Plus className="mr-2 h-4 w-4" />新建模型</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {industries.map((ind) => {
          const IndIcon = iconMap[ind.icon] || Factory
          return (
            <Card
              key={ind.id}
              className="hover:border-primary/50 transition-colors cursor-pointer group"
              onClick={() => handleIndustryClick(ind)}
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <IndIcon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">{ind.name}</h3>
                    <p className="text-xs text-muted-foreground">{ind.description}</p>
                  </div>
                  {ind.isPreset && (
                    <span className="ml-auto text-xs bg-muted px-1.5 py-0.5 rounded">预置</span>
                  )}
                </div>
                {ind.scenarios && ind.scenarios.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">可用场景</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ind.scenarios.map((sc) => {
                        const SIcon = scenarioIcons[sc.code] || Brain
                        return (
                          <span
                            key={sc.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted hover:bg-primary/10 hover:text-primary cursor-pointer transition-colors text-xs"
                            onClick={(e) => handleScenarioClick(e, sc)}
                            title={sc.description}
                          >
                            <SIcon className="h-3 w-3" /> {sc.name}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  <Sparkles className="h-3 w-3" /> 点击创建模型
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
