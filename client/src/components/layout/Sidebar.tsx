import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/stores/appStore'
import { useAuthStore } from '@/stores/authStore'
import {
  LayoutDashboard, Factory, Database, Brain, FlaskConical,
  Rocket, Settings, ChevronLeft, ChevronRight, Zap,
  Cpu, HeartPulse, Wrench, Boxes
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { roleSatisfies } from '@/lib/role'
import type { UserRole } from '@/lib/role'

const navItems = [
  { label: '概览', icon: LayoutDashboard, path: '/app/dashboard' },
  { label: '行业场景', icon: Factory, path: '/app/industries' },
  { label: '数据管理', icon: Database, path: '/app/datasets' },
  { label: '模型管理', icon: Brain, path: '/app/models' },
  { label: '训练任务', icon: FlaskConical, path: '/app/training', minRole: 'MANAGER' as const },
  { label: '部署管理', icon: Rocket, path: '/app/deployments', minRole: 'MANAGER' as const },
  { label: '模型推理', icon: Zap, path: '/app/inference' },
  { label: '设备管理', icon: Cpu, path: '/app/devices' },
  { label: '健康看板', icon: HeartPulse, path: '/app/health' },
  { label: '接入生成器', icon: Boxes, path: '/app/ingest' },
  { label: '维修工单', icon: Wrench, path: '/app/maintenance', minRole: 'MANAGER' as const },
  { label: '系统设置', icon: Settings, path: '/app/settings', minRole: 'ADMIN' as const },
]

export function Sidebar() {
  const location = useLocation()
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const user = useAuthStore((s) => s.user)
  const userRole = (user?.role || 'VIEWER') as UserRole
  const branding = user?.tenant?.branding

  const visibleItems = navItems.filter(
    item => !item.minRole || roleSatisfies(userRole, item.minRole)
  )

  return (
    <aside className={`flex flex-col border-r bg-card transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-56'}`}>
      <div className="flex h-14 items-center border-b px-3 gap-2">
        {!sidebarCollapsed && (
          <span className="font-semibold text-sm truncate" style={{ color: branding?.primaryColor }}>
            {branding?.companyName || 'AI训练平台'}
          </span>
        )}
        <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 shrink-0" onClick={toggleSidebar}>
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {visibleItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
