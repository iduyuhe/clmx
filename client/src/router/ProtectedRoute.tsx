import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { roleSatisfies } from '@/lib/role'
import type { UserRole } from '@/lib/role'

/** Shared hook for auth initialization + loading state */
function useAuthInit() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const initFromStorage = useAuthStore((s) => s.initFromStorage)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (token && isLoading) {
      initFromStorage()
    }
  }, [token, isLoading, initFromStorage])

  return { isAuthenticated, isLoading, user }
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthInit()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/auth/login" replace />
  return <>{children}</>
}

/** Require both authentication AND a minimum role */
export function RoleGuard({ children, minRole }: { children: React.ReactNode; minRole: UserRole }) {
  const { isAuthenticated, isLoading, user } = useAuthInit()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/auth/login" replace />

  const userRole = (user?.role || 'VIEWER') as UserRole
  if (!roleSatisfies(userRole, minRole)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <h2 className="text-lg font-medium">403 - 权限不足</h2>
        <p className="text-muted-foreground text-sm">您没有访问此页面的权限</p>
        <button
          className="text-sm text-primary hover:underline"
          onClick={() => window.history.back()}
        >
          返回上一页
        </button>
      </div>
    )
  }

  return <>{children}</>
}
