import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const loginSchema = z.object({
  email: z.string().email('请输入有效的邮箱'),
  password: z.string().min(6, '密码至少6位'),
})

type LoginForm = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const branding = useAuthStore((s) => s.user?.tenant?.branding)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (data: LoginForm) => {
    setLoading(true)
    setError('')
    try {
      const res = await authApi.login(data)
      setAuth(res.data.token, res.data.user)
      navigate('/app/dashboard')
    } catch (e: unknown) {
      const msg = getApiErrorMessage(e, '登录失败，请检查邮箱和密码')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-0 shadow-none bg-transparent">
      <CardHeader className="text-center pb-2">
        {branding?.logoUrl && (
          <img
            src={branding.logoUrl}
            alt="logo"
            className="mx-auto h-12 w-12 rounded object-contain mb-2"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <CardTitle className="text-2xl" style={branding?.primaryColor ? { color: branding.primaryColor } : undefined}>
          {branding?.companyName || '登录'}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{branding?.companyName ? '请登录以继续使用' : '垂类大模型训练平台'}</p>
      </CardHeader>
      <CardContent>
        {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" type="email" placeholder="your@email.com" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" placeholder="******" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading} style={branding?.primaryColor ? { backgroundColor: branding.primaryColor } : undefined}>
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          还没有账号？<Link to="/auth/register" className="text-primary hover:underline">立即注册</Link>
        </p>
      </CardFooter>
    </Card>
  )
}
