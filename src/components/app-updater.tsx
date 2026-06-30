import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { installAvailableUpdate, updateErrorMessage } from '@/lib/updater'
import { Button } from '@/components/ui/button'

function progressText(downloaded: number, total?: number) {
  if (!total) return '正在下载更新...'
  return `正在下载更新 ${Math.round((downloaded / total) * 100)}%`
}

export function AutoUpdater() {
  useEffect(() => {
    if (import.meta.env.DEV) return

    let toastId: string | number | undefined
    installAvailableUpdate(({ downloaded, total }) => {
      toastId = toast.loading(progressText(downloaded, total), { id: toastId })
    }).catch((error) => {
      if (toastId) {
        toast.error(`自动更新失败：${updateErrorMessage(error)}`, {
          id: toastId,
        })
      }
    })
  }, [])

  return null
}

export function UpdatePanel() {
  const [isChecking, setIsChecking] = useState(false)

  async function handleUpdate() {
    setIsChecking(true)
    let toastId: string | number | undefined = toast.loading('正在检查更新...')
    try {
      const result = await installAvailableUpdate(({ downloaded, total }) => {
        toastId = toast.loading(progressText(downloaded, total), {
          id: toastId,
        })
      })

      if (result.status === 'current') {
        toast.success('当前已是最新版本', { id: toastId })
      }
      if (result.status === 'unsupported') {
        toast.info('网页预览环境不支持自动更新，请打开桌面应用', {
          id: toastId,
        })
      }
    } catch (error) {
      toast.error(`更新失败：${updateErrorMessage(error)}`, { id: toastId })
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className='rounded-lg border bg-card p-4 text-card-foreground shadow-sm'>
      <div className='flex items-center justify-between gap-4'>
        <div className='space-y-1'>
          <h4 className='text-sm font-medium'>版本更新</h4>
          <p className='text-sm text-muted-foreground'>
            当前版本 v{__APP_VERSION__}
          </p>
        </div>
        <Button onClick={handleUpdate} disabled={isChecking} size='sm'>
          {isChecking ? (
            <RefreshCw className='size-4 animate-spin' />
          ) : (
            <Download className='size-4' />
          )}
          检查更新
        </Button>
      </div>
    </div>
  )
}
