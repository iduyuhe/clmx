import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CheckCircle2, Database, Brain, Zap, ArrowRight } from 'lucide-react'

const PLANS = [
  { id: 'TRIAL', label: '试用版', price: '免费', desc: '50 数据点 / 1,000 次调用', features: ['基础功能', '社区支持'] },
  { id: 'FREE', label: '免费版', price: '免费', desc: '1M 数据点 / 10,000 次调用', features: ['非商业用途', '标准支持', '基础配额'] },
  { id: 'PRO', label: '专业版', price: '¥9,999/月', desc: '20M 数据点 / 50,000 次调用', features: ['商业使用', '优先支持', '高级配额', '白标'] },
]

const registerSchema = z.object({
  name: z.string().min(2, '姓名至少2个字符'),
  email: z.string().email('请输入有效的邮箱'),
  companyName: z.string().min(1, '请输入公司名称'),
  password: z.string().min(6, '密码至少6位'),
  confirmPassword: z.string(),
  planType: z.string().optional(),
}).refine((d) => d.password === d.confirmPassword, { message: '两次密码不一致', path: ['confirmPassword'] })

type RegisterForm = z.infer<typeof registerSchema>

export function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [planType, setPlanType] = useState('FREE')
  const [showWelcome, setShowWelcome] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) })

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true)
    setError('')
    try {
      const res = await authApi.register({ ...data, planType })
      setAuth(res.data.token, res.data.user)
      setShowWelcome(true)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; code?: string }
      if (err.response?.data?.message) {
        setError(err.response.data.message)
      } else if (err.code === 'ERR_NETWORK') {
        setError('网络连接失败，请检查后端服务是否启动')
      } else {
        setError('注册失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-0 shadow-none bg-transparent">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-2xl">注册</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">创建您的训练平台租户</p>
      </CardHeader>
      <CardContent>
        {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">姓名</Label>
            <Input id="name" placeholder="您的姓名" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" type="email" placeholder="your@email.com" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyName">公司名称</Label>
            <Input id="companyName" placeholder="贵公司名称" {...register('companyName')} />
            {errors.companyName && <p className="text-xs text-destructive">{errors.companyName.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>选择套餐</Label>
            <div className="grid grid-cols-3 gap-2">
              {PLANS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlanType(p.id)}
                  className={`rounded-lg border p-3 text-left transition ${planType === p.id ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{p.label}</span>
                    <span className="text-xs text-muted-foreground">{p.price}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.desc}</p>
                  <ul className="mt-1 space-y-0.5">
                    {p.features.map((f) => <li key={f} className="text-xs text-muted-foreground">· {f}</li>)}
                  </ul>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" placeholder="至少6位" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">确认密码</Label>
            <Input id="confirmPassword" type="password" placeholder="再次输入" {...register('confirmPassword')} />
            {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '注册中...' : '创建账号'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          已有账号？<Link to="/auth/login" className="text-primary hover:underline">立即登录</Link>
        </p>
      </CardFooter>

      {/* 注册成功欢迎对话框 */}
      <Dialog open={showWelcome} onOpenChange={() => { setShowWelcome(false); navigate('/app/dashboard') }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-6 w-6 text-green-500" />注册成功，欢迎使用 CLMX！
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">你的租户已创建（{planType === 'FREE' ? '免费版' : planType === 'TRIAL' ? '试用版' : '专业版'}套餐）。以下是你接下来的操作步骤：</p>
            <div className="space-y-3">
              {[
                { icon: Database, title: '1. 生成演示数据', desc: '设置 → 演示数据，一键生成仿真设备和 NLP 样本' },
                { icon: Brain, title: '2. 训练 NLP 模型', desc: '模型管理 → DEMO-中文情感分析模型 → 发起训练（10秒完成）' },
                { icon: Zap, title: '3. 体验推理', desc: '模型推理 → 我的训练模型，选择刚训练的版本进行中文情感分析' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <item.icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              💡 在「设置 → 品牌定制」中可配置你的公司 Logo、主色调和自定义域名。如需更多帮助，请联系技术支持。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setShowWelcome(false); navigate('/app/dashboard') }}>
              进入系统 <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
