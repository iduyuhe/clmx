import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { TopNavBar } from './TopNavBar'
import { Sidebar } from './Sidebar'
import { ChatCommand } from '../ChatCommand'
import { useAuthStore } from '@/stores/authStore'

export function AppLayout({ children }: { children?: ReactNode }) {
  const branding = useAuthStore((s) => s.user?.tenant?.branding)

  // 将白标应用到全局：favicon、文档标题、品牌主色 CSS 变量
  useEffect(() => {
    if (!branding) return
    if (branding.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
      link.href = branding.faviconUrl
    }
    if (branding.companyName) document.title = branding.companyName
    if (branding.primaryColor) document.documentElement.style.setProperty('--brand', branding.primaryColor)
  }, [branding])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNavBar />
        <main className="flex-1 overflow-auto p-6">
          {children || <Outlet />}
        </main>
        <ChatCommand />
      </div>
    </div>
  )
}
