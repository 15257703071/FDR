import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { installAvailableUpdate, updateErrorMessage } from '@/lib/updater'
import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'

declare const __APP_VERSION__: string

export function Settings() {
  const [isChecking, setIsChecking] = useState(false)
  const appVersion =
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.1'

  async function handleUpdate() {
    setIsChecking(true)
    let toastId: string | number | undefined = toast.loading('正在检查更新...')
    try {
      const result = await installAvailableUpdate(({ downloaded, total }) => {
        const progressText = total
          ? `正在下载更新 ${Math.round((downloaded / total) * 100)}%`
          : '正在下载更新...'
        toastId = toast.loading(progressText, { id: toastId })
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
    <>
      <Header>
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
        </div>
      </Header>

      <Main fixed>
        <div className='space-y-4'>
          <div className='space-y-0.5'>
            <span className='text-sm text-muted-foreground'>关于</span>
          </div>
          <div className='rounded-lg border bg-card text-card-foreground shadow-sm'>
            <div className='divide-y divide-border'>
              <div className='flex items-center justify-between p-6'>
                <span className='text-sm font-medium'>版本</span>
                <span className='text-sm text-muted-foreground'>
                  {appVersion}
                </span>
              </div>
              <div className='flex items-center justify-between p-6'>
                <span className='text-sm font-medium'>检查更新</span>
                <Button
                  onClick={handleUpdate}
                  disabled={isChecking}
                  variant='outline'
                  size='sm'
                  className='flex items-center gap-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground'
                >
                  {isChecking ? (
                    <RefreshCw className='size-4 animate-spin' />
                  ) : (
                    <Download className='size-4' />
                  )}
                  检查更新
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Main>
    </>
  )
}
