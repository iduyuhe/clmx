import axios from 'axios'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
})

// ⚠️ 生产环境建议：Token 应存储在 httpOnly Cookie 中（需后端配合设置 Set-Cookie）
// 当前使用 sessionStorage（浏览器关闭时自动清除），避免持久化泄露风险
function getToken(): string | null {
  return sessionStorage.getItem('token')
}

function setToken(token: string): void {
  sessionStorage.setItem('token', token)
}

function removeToken(): void {
  sessionStorage.removeItem('token')
  sessionStorage.removeItem('user')
}

apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // 通过 Zustand store API 直接登出，触发 React Router 导航（无整页刷新）
      import('@/stores/authStore').then(({ useAuthStore }) => {
        useAuthStore.getState().logout()
      })
    }
    return Promise.reject(err)
  }
)

export { getToken, setToken, removeToken }
export default apiClient
