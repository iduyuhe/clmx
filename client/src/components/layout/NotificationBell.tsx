import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'
import { notificationApi } from '@/api'
import { getApiErrorMessage } from '@/types/common'
import { Button } from '@/components/ui/button'

const levelDot: Record<string, string> = {
  CRITICAL: 'bg-destructive',
  WARNING: 'bg-amber-500',
  INFO: 'bg-primary',
}

export function NotificationBell() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data, refetch } = useQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: () => notificationApi.getInbox({ pageSize: 15 }),
    refetchInterval: 30_000,
  })
  const inbox = data?.data
  const unread = inbox?.unreadCount || 0
  const items = inbox?.data || []

  const readMut = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'inbox'] }),
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '操作失败')),
  })
  const readAllMut = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'inbox'] }),
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, '操作失败')),
  })

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative h-8 w-8"
        onClick={() => { setOpen((o) => !o); if (!open) refetch() }}
        aria-label="通知"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">通知{unread > 0 ? `（${unread} 条未读）` : ''}</span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => readAllMut.mutate()}
                disabled={readAllMut.isPending || unread === 0}
              >
                全部已读
              </button>
            </div>
            <div className="max-h-96 overflow-auto">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无通知</p>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    className={`flex cursor-pointer gap-2 border-b px-3 py-2 last:border-0 ${n.read ? '' : 'bg-primary/5'}`}
                    onClick={() => !n.read && readMut.mutate(n.id)}
                  >
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${levelDot[n.level] || 'bg-primary'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
