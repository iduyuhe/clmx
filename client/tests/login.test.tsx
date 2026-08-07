import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginPage } from '@/pages/auth/LoginPage'

// Mock zustand
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: any) => {
    const state = { setAuth: vi.fn() }
    return selector ? selector(state) : state
  },
}))

// Mock API
vi.mock('@/api', () => ({
  authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn(), changePassword: vi.fn() },
}))

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/auth/login']}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染登录表单：邮箱、密码输入框和登录按钮', () => {
    renderWithProviders(<LoginPage />)

    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('渲染标题和副标题', () => {
    renderWithProviders(<LoginPage />)
    // CardTitle is a div with data-slot="card-title"
    const title = document.querySelector('[data-slot="card-title"]')
    expect(title).toBeInTheDocument()
    expect(title).toHaveTextContent('登录')
    expect(screen.getByText('垂类大模型训练平台')).toBeInTheDocument()
  })

  it('渲染注册链接', () => {
    renderWithProviders(<LoginPage />)
    expect(screen.getByText('立即注册')).toBeInTheDocument()
  })
})
