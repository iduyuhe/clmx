import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useAppStore } from '@/stores/appStore'
import { authApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { LogOut, User, Menu, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from './NotificationBell'

export function TopNavBar() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { toggleSidebar } = useAppStore()
  const initials = user?.name?.slice(0, 2).toUpperCase() || 'U'

  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')

  const pwdMut = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => { toast.success('密码修改成功，请重新登录'); setPwdOpen(false); setTimeout(() => logout(), 1500) },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '修改失败')),
  })

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-card px-4">
      <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={toggleSidebar}>
        <Menu className="h-4 w-4" />
      </Button>
      <div className="flex-1" />
      <NotificationBell />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 h-8 px-2">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="text-sm hidden md:inline">{user?.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => navigate('/app/settings')}>
            <User className="mr-2 h-4 w-4" /> 个人信息
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setOldPwd(''); setNewPwd(''); setPwdOpen(true) }}>
            <KeyRound className="mr-2 h-4 w-4" /> 修改密码
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-destructive">
            <LogOut className="mr-2 h-4 w-4" /> 退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>修改密码</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1">
              <Label>旧密码 *</Label>
              <Input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="输入当前密码" />
            </div>
            <div className="grid gap-1">
              <Label>新密码 *</Label>
              <Input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少6位" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
            <Button onClick={() => {
              if (!oldPwd || !newPwd) return toast.error('请填写旧密码和新密码')
              if (newPwd.length < 6) return toast.error('新密码至少6位')
              pwdMut.mutate({ oldPassword: oldPwd, newPassword: newPwd })
            }} disabled={pwdMut.isPending}>确认修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}
