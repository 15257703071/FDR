import type { DownloadEvent } from '@tauri-apps/plugin-updater'

type UpdateProgress = {
  downloaded: number
  total?: number
}

type UpdateResult =
  | { status: 'unsupported' }
  | { status: 'current' }
  | { status: 'updated'; version: string }

export function canUseUpdater() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function installAvailableUpdate(
  onProgress?: (progress: UpdateProgress) => void
): Promise<UpdateResult> {
  if (!canUseUpdater()) {
    return { status: 'unsupported' }
  }

  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ])

  const update = await check()
  if (!update) {
    return { status: 'current' }
  }

  let downloaded = 0
  let total: number | undefined
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === 'Started') {
      total = event.data.contentLength
      onProgress?.({ downloaded, total })
    }
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      onProgress?.({ downloaded, total })
    }
  })

  await relaunch()
  return { status: 'updated', version: update.version }
}
