import { create } from 'zustand'
import type { User } from '@/types/models'
import { getToken, setToken, removeToken } from '@/api/client'

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setAuth: (token: string, user: User) => void
  setUser: (user: User) => void
  logout: () => void
  setLoading: (v: boolean) => void
  initFromStorage: () => Promise<void>
}

const STORAGE_USER_KEY = 'user'

function loadUser(): User | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveUser(user: User): void {
  sessionStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user))
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // ⚠️ 生产环境建议：Token 应由后端通过 httpOnly Secure SameSite Cookie 下发
  // 当前使用 sessionStorage（浏览器关闭自动清除），降低持久泄露风险
  token: getToken(),
  user: loadUser(),
  isAuthenticated: !!getToken(),
  isLoading: !getToken() ? false : true,

  setAuth: (token, user) => {
    setToken(token)
    saveUser(user)
    set({ token, user, isAuthenticated: true, isLoading: false })
  },
  setUser: (user) => {
    saveUser(user)
    set({ user })
  },
  logout: () => {
    removeToken()
    // sessionStorage.clear() 会清掉所有会话数据，更安全但不一定需要
    set({ token: null, user: null, isAuthenticated: false, isLoading: false })
  },
  setLoading: (v) => set({ isLoading: v }),

  initFromStorage: async () => {
    const token = get().token
    if (!token) {
      set({ isLoading: false, isAuthenticated: false })
      return
    }
    try {
      const { authApi } = await import('@/api/index')
      const res = await authApi.me()
      if (res.success && res.data) {
        saveUser(res.data)
        set({ user: res.data, isAuthenticated: true, isLoading: false })
      } else {
        throw new Error('invalid token')
      }
    } catch {
      removeToken()
      set({ token: null, user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
