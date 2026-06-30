import { useState } from 'react'
import { flushSync } from 'react-dom'
import {
  FileUp,
  FileSpreadsheet,
  FolderOpen,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Play,
  RotateCcw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Separator } from '@/components/ui/separator'

interface HeaderItem {
  col: string
  name: string
}

type ExcelHeadersResponse = {
  status: 'success' | 'error'
  headers: HeaderItem[]
  message?: string
}

interface MatchResult {
  row: number
  name: string
  reg_vin: string
  ocr_vin: string
  all_vins: string
  status: '匹配' | '不匹配' | '匹配失败'
  reg_duplicate: boolean
  ocr_duplicate: boolean
  matched: boolean
  reg_len_ok: boolean
  ocr_len_ok: boolean
  reg_check_ok: boolean
  ocr_check_ok: boolean
  texts_debug: string
}

type OcrProgressPayload = {
  type?: 'status' | 'progress' | 'done'
  status?: 'error' | 'success' | MatchResult['status']
  message?: string
  current?: number
  total?: number
  output_path?: string
  row?: number
  name?: string
  reg_vin?: string
  ocr_vin?: string
  all_vins?: string
  reg_duplicate?: boolean
  ocr_duplicate?: boolean
  matched?: boolean
  reg_len_ok?: boolean
  ocr_len_ok?: boolean
  reg_check_ok?: boolean
  ocr_check_ok?: boolean
  texts_debug?: string
}

export function OcrMatch() {
  // 文件状态
  const [filePath, setFilePath] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [folderPath, setFolderPath] = useState<string>('')
  const [folderName, setFolderName] = useState<string>('')
  const [matchMode, setMatchMode] = useState<'excel' | 'folder'>('excel')
  const [headers, setHeaders] = useState<HeaderItem[]>([])
  const [vinCol, setVinCol] = useState<string>('')
  const [imgCol, setImgCol] = useState<string>('')
  const [isScanningHeaders, setIsScanningHeaders] = useState<boolean>(false)

  // 匹配状态
  const [isMatching, setIsMatching] = useState<boolean>(false)
  const [progress, setProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  })
  const [statusText, setStatusText] = useState<string>('')
  const [matchResults, setMatchResults] = useState<MatchResult[]>([])
  const [outputPath, setOutputPath] = useState<string>('')

  // UI / 筛选状态
  const [dragActive, setDragActive] = useState<boolean>(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [errorText, setErrorText] = useState<string>('')

  const switchMode = (mode: 'excel' | 'folder') => {
    if (mode === matchMode) return
    setMatchMode(mode)
    setMatchResults([])
    setOutputPath('')
    setProgress({ current: 0, total: 0 })
    setStatusText('')
    setErrorText('')
  }

  // 处理拖拽上传逻辑
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (!file.name.endsWith('.xlsx')) {
        toast.error('仅支持上传 Excel 格式文件 (.xlsx)')
        return
      }
      
      // 在 Tauri 环境中可以通过 file 对象的路径，但因为 H5 限制，
      // Tauri 推荐使用 plugin-dialog 的 open API 来读取文件的绝对路径最为稳妥。
      // 为方便用户，支持拖拽文件获取其绝对路径：
      // 在 Tauri App 里，拖拽获取到的 file 对象其实是带 path 属性的
      const rawFile = file as File & { path?: string }
      if (rawFile.path) {
        loadExcel(rawFile.path, file.name)
      } else {
        // 如果是在纯 H5 浏览器中预览，通过系统 Dialog 选择文件
        selectFileViaDialog()
      }
    }
  }

  const selectFileViaDialog = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
      })
      if (selected && typeof selected === 'string') {
        const pathParts = selected.split(/[\\/]/)
        const name = pathParts[pathParts.length - 1]
        loadExcel(selected, name)
      }
    } catch (e) {
      toast.error(`打开文件选择框失败: ${String(e)}`)
    }
  }

  const selectFolderViaDialog = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        directory: true,
      })
      if (selected && typeof selected === 'string') {
        const pathParts = selected.split(/[\\/]/)
        setFolderPath(selected)
        setFolderName(pathParts[pathParts.length - 1])
        setOutputPath('')
        setMatchResults([])
        setProgress({ current: 0, total: 0 })
        setStatusText('')
        setErrorText('')
      }
    } catch (e) {
      toast.error(`打开文件夹选择框失败: ${String(e)}`)
    }
  }

  const loadExcel = async (path: string, name: string) => {
    setFilePath(path)
    setFileName(name)
    setIsScanningHeaders(true)
    setHeaders([])
    setVinCol('')
    setImgCol('')
    setOutputPath('')
    setMatchResults([])

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const resultJson = await invoke<string>('get_excel_headers', { 
        filePath: path,
      })
      const result = JSON.parse(resultJson) as ExcelHeadersResponse
      if (result.status === 'success') {
        setHeaders(result.headers)
        // 智能猜测常用列
        const vinHeader =
          result.headers.find((h) => h.name.includes('车架') || h.name.includes('VIN')) ||
          result.headers.find((h) => h.col === 'D')
        const imgHeader =
          result.headers.find((h) => h.col === 'AA') ||
          result.headers.find((h) => h.name.includes('合格证') || h.name.includes('图片'))
        if (vinHeader) setVinCol(vinHeader.col)
        if (imgHeader) setImgCol(imgHeader.col)
        toast.success('Excel 列头解析成功')
      } else {
        toast.error(result.message || '列头解析失败')
      }
    } catch (e) {
      toast.error(`读取 Excel 元数据失败: ${String(e)}`)
    } finally {
      setIsScanningHeaders(false)
    }
  }

  const runOcrCommand = async (command: string, args: Record<string, string>) => {
    flushSync(() => {
      setIsMatching(true)
      setMatchResults([])
      setProgress({ current: 0, total: 0 })
      setStatusText('正在提交 OCR 任务...')
      setOutputPath('')
      setErrorText('')
    })

    let unlistenProgress: (() => void) | null = null
    let sawBackendProgress = false
    let finished = false
    const cleanup = () => {
      window.clearTimeout(startupTimer)
      window.clearTimeout(slowStartupTimer)
      if (unlistenProgress) {
        unlistenProgress()
        unlistenProgress = null
      }
    }
    const finishWithError = (message: string) => {
      if (finished) return
      finished = true
      setErrorText(message)
      setStatusText(message)
      setIsMatching(false)
      cleanup()
      toast.error(message)
    }
    const finishWithSuccess = (path: string) => {
      if (finished) return
      finished = true
      setOutputPath(path)
      setStatusText('比对完成，结果文件已导出')
      setProgress((prev) => ({ current: prev.total || prev.current, total: prev.total || prev.current }))
      setIsMatching(false)
      cleanup()
      toast.success('比对匹配完成！新文件已导出')
    }
    const startupTimer = window.setTimeout(() => {
      if (sawBackendProgress) return
      setStatusText('Rust OCR 正在启动，正在等待模型加载或 Excel 解析...')
    }, 3000)
    const slowStartupTimer = window.setTimeout(() => {
      if (sawBackendProgress) return
      setStatusText('仍在初始化 OCR；如果文件很大或首次运行，请再等一下...')
    }, 15000)

    try {
      const { listen } = await import('@tauri-apps/api/event')
      const { invoke } = await import('@tauri-apps/api/core')
      // 监听 Rust 后台任务发出来的进度事件
      unlistenProgress = await listen<string>('ocr-progress', (event) => {
        try {
          sawBackendProgress = true
          const data = JSON.parse(event.payload) as OcrProgressPayload
          if (data.status === 'error') {
            finishWithError(data.message || 'OCR 匹配失败')
          } else if (data.type === 'status') {
            setStatusText(data.message ?? '')
            if (typeof data.total === 'number') {
              const total = data.total
              setProgress((prev) => ({
                current: typeof data.current === 'number' ? data.current : prev.current,
                total,
              }))
            }
          } else if (data.type === 'progress') {
            if (
              typeof data.current !== 'number' ||
              typeof data.total !== 'number' ||
              typeof data.row !== 'number'
            ) {
              return
            }
            const current = data.current
            const total = data.total
            const row = data.row
            setProgress({ current, total })
            
            setMatchResults((prev) => {
              const filtered = prev.filter((r) => r.row !== row)
              return [...filtered, {
                row,
                name: data.name ?? '',
                reg_vin: data.reg_vin ?? '',
                ocr_vin: data.ocr_vin ?? '',
                all_vins: data.all_vins ?? '',
                status: (data.status as MatchResult['status']) ?? '匹配失败',
                reg_duplicate: Boolean(data.reg_duplicate),
                ocr_duplicate: Boolean(data.ocr_duplicate),
                matched: Boolean(data.matched),
                reg_len_ok: Boolean(data.reg_len_ok),
                ocr_len_ok: Boolean(data.ocr_len_ok),
                reg_check_ok: Boolean(data.reg_check_ok),
                ocr_check_ok: Boolean(data.ocr_check_ok),
                texts_debug: data.texts_debug ?? '',
              }].sort((a, b) => a.row - b.row)
            })
          } else if (data.type === 'done') {
            if (data.status === 'success' && data.output_path) {
              finishWithSuccess(data.output_path)
            }
          }
        } catch {
          // Ignore malformed progress events from older builds.
        }
      })

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      await invoke(command, args)
    } catch (e) {
      const msg = String(e)
      finishWithError(`OCR 运行失败: ${msg}`)
    }
  }

  const startOcrMatchProcess = async () => {
    if (!filePath) {
      toast.error('请先选择或拖入 Excel 文件')
      return
    }
    if (!vinCol || !imgCol) {
      toast.error('请指定登记车架号列与合格证图片列')
      return
    }
    await runOcrCommand('start_ocr_match', { filePath, vinCol, imgCol })
  }

  const startFolderOcrMatchProcess = async () => {
    if (!folderPath) {
      toast.error('请先选择车架号根文件夹')
      return
    }
    await runOcrCommand('start_folder_ocr_match', { rootDir: folderPath })
  }

  const openOutputFolder = async () => {
    if (!outputPath) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('show_in_folder', { path: outputPath })
    } catch {
      toast.error('无法打开文件路径')
    }
  }

  // 过滤和检索表格数据
  const filteredResults = matchResults.filter((item) => {
    const statusMatch = filterStatus === 'all' || item.status === filterStatus
    const query = searchQuery.trim().toLowerCase()
    const searchMatch =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.reg_vin.toLowerCase().includes(query) ||
      item.ocr_vin.toLowerCase().includes(query) ||
      String(item.row).includes(query)
    return statusMatch && searchMatch
  })

  // 计算百分比
  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const summaryRows = [
    { label: '登记重复', yes: matchResults.filter((r) => r.reg_duplicate).length },
    { label: 'OCR重复', yes: matchResults.filter((r) => r.ocr_duplicate).length },
    { label: '匹配', yes: matchResults.filter((r) => r.matched).length },
    { label: '登记17位', yes: matchResults.filter((r) => r.reg_len_ok).length },
    { label: 'OCR17位', yes: matchResults.filter((r) => r.ocr_len_ok).length },
    { label: '登记校验码', yes: matchResults.filter((r) => r.reg_check_ok).length },
    { label: 'OCR校验码', yes: matchResults.filter((r) => r.ocr_check_ok).length },
  ].map((item) => ({ ...item, no: matchResults.length - item.yes }))

  return (
    <>
      <Header>
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
        </div>
      </Header>

      <Main fixed className='flex flex-col gap-6 overflow-hidden'>
        {/* Title */}
        <div className='flex shrink-0 flex-col justify-between gap-4 md:flex-row md:items-center'>
          <div>
            <h1 className='flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl'>
              <FileSpreadsheet className='h-8 w-8 text-primary' />
              车架号 OCR 匹配工具
            </h1>
            <p className='mt-1 text-muted-foreground'>
              上传 Excel 台账，提取合格证图片进行 OCR 识别，并与登记车架号智能比对。
            </p>
          </div>
        </div>

        <Separator className='shrink-0' />

        <div className='flex shrink-0 rounded-lg border bg-muted/30 p-1 text-sm'>
          <button
            type='button'
            onClick={() => switchMode('excel')}
            className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
              matchMode === 'excel' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            Excel 匹配
          </button>
          <button
            type='button'
            onClick={() => switchMode('folder')}
            className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
              matchMode === 'folder' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            文件夹匹配
          </button>
        </div>

        {isMatching && (
          <div className='shrink-0 rounded-lg border bg-card p-4 shadow-sm'>
            <div className='mb-2 flex items-center justify-between gap-4 text-sm'>
              <div className='flex min-w-0 items-center gap-2 font-medium'>
                <RotateCcw className='h-4 w-4 shrink-0 animate-spin text-primary' />
                <span className='truncate'>{statusText || '正在启动后台 OCR 运算引擎...'}</span>
              </div>
              <span className='shrink-0 text-xs text-muted-foreground'>
                {progress.total > 0
                  ? `${progress.current}/${progress.total} (${progressPercent}%)`
                  : '准备中'}
              </span>
            </div>
            <div
              className='h-2 overflow-hidden rounded-full bg-muted'
              role='progressbar'
              aria-valuemin={0}
              aria-valuemax={progress.total || undefined}
              aria-valuenow={progress.total ? progress.current : undefined}
            >
              <div
                className={`h-full rounded-full bg-primary transition-all duration-300 ${
                  progress.total ? '' : 'animate-pulse'
                }`}
                style={{ width: `${progress.total ? progressPercent : 24}%` }}
              />
            </div>
          </div>
        )}

        {/* Scrollable Work Area */}
        <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1'>
          
          {/* Card 1: Import and Configurations */}
          <div className='rounded-xl border bg-card p-5 text-card-foreground shadow-sm'>
            <h3 className='mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider'>
              {matchMode === 'excel' ? '第一步：上传台账与选择列名' : '第一步：选择车架号根文件夹'}
            </h3>
            
            {matchMode === 'excel' ? (
            <div className='grid gap-6 md:grid-cols-3'>
              {/* Left Column: File Dropzone */}
              <div className='md:col-span-1'>
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={selectFileViaDialog}
                  className={`flex h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                    dragActive
                      ? 'border-primary bg-primary/5'
                      : filePath
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-accent'
                  }`}
                >
                  <FileUp className={`mb-2 h-10 w-10 ${filePath ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
                  {filePath ? (
                    <div className='px-4 text-center'>
                      <p className='text-xs font-semibold text-emerald-600 dark:text-emerald-400 truncate max-w-[200px]'>
                        {fileName}
                      </p>
                      <p className='mt-1 text-[10px] text-muted-foreground'>已选择，点击更换</p>
                    </div>
                  ) : (
                    <div className='text-center px-4'>
                      <p className='text-xs font-medium'>拖入或点击上传 Excel (.xlsx)</p>
                      <p className='mt-1 text-[10px] text-muted-foreground'>系统会自动读取单元格中的图片</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Dynamic Column Configs */}
              <div className='flex flex-col justify-between md:col-span-2'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div>
                    <label className='block text-xs font-semibold text-muted-foreground mb-1.5'>
                      车架号列 (登记车架号文本)
                    </label>
                    <select
                      value={vinCol}
                      onChange={(e) => setVinCol(e.target.value)}
                      disabled={isScanningHeaders || isMatching || headers.length === 0}
                      className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring'
                    >
                      <option value=''>-- 请选择车架号文本列 --</option>
                      {headers.map((h) => (
                        <option key={h.col} value={h.col}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className='block text-xs font-semibold text-muted-foreground mb-1.5'>
                      图片所在列 (合格证图片单元格)
                    </label>
                    <select
                      value={imgCol}
                      onChange={(e) => setImgCol(e.target.value)}
                      disabled={isScanningHeaders || isMatching || headers.length === 0}
                      className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring'
                    >
                      <option value=''>-- 请选择合格证图片列 --</option>
                      {headers.map((h) => (
                        <option key={h.col} value={h.col}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className='mt-4 flex items-center justify-end gap-2'>
                  {filePath && headers.length === 0 && !isScanningHeaders && (
                    <Button variant='ghost' size='sm' onClick={() => loadExcel(filePath, fileName)}>
                      重新解析表头
                    </Button>
                  )}
                  <Button
                    onClick={startOcrMatchProcess}
                    disabled={!filePath || !vinCol || !imgCol || isMatching || isScanningHeaders}
                    className='w-full sm:w-auto flex items-center gap-2'
                  >
                    {isMatching ? (
                      <>
                        <RotateCcw className='h-4 w-4 animate-spin' />
                        正在比对 OCR...
                      </>
                    ) : (
                      <>
                        <Play className='h-4 w-4 fill-current' />
                        开始 OCR 匹配
                      </>
                    )}
                  </Button>
                </div>

                {(isMatching || progress.total > 0) && (
                  <div className='mt-4 space-y-2 rounded-md border bg-muted/20 p-3'>
                    <div className='flex items-center justify-between gap-3 text-xs'>
                      <span className='truncate text-muted-foreground'>
                        {statusText || '正在准备 OCR 匹配...'}
                      </span>
                      <span className='shrink-0 font-medium'>
                        {progress.total > 0
                          ? `${progress.current}/${progress.total} (${progressPercent}%)`
                          : '准备中'}
                      </span>
                    </div>
                    <div
                      className='h-2 overflow-hidden rounded-full bg-muted'
                      role='progressbar'
                      aria-valuemin={0}
                      aria-valuemax={progress.total || undefined}
                      aria-valuenow={progress.total ? progress.current : undefined}
                    >
                      <div
                        className={`h-full rounded-full bg-primary transition-all duration-300 ${
                          progress.total ? '' : 'animate-pulse'
                        }`}
                        style={{ width: `${progress.total ? progressPercent : 12}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            ) : (
              <div className='grid gap-6 md:grid-cols-3'>
                <div
                  onClick={selectFolderViaDialog}
                  className={`flex h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                    folderPath
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-accent'
                  }`}
                >
                  <FolderOpen className={`mb-2 h-10 w-10 ${folderPath ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
                  {folderPath ? (
                    <div className='px-4 text-center'>
                      <p className='max-w-[240px] truncate text-xs font-semibold text-emerald-600 dark:text-emerald-400'>
                        {folderName}
                      </p>
                      <p className='mt-1 text-[10px] text-muted-foreground'>已选择，点击更换</p>
                    </div>
                  ) : (
                    <div className='px-4 text-center'>
                      <p className='text-xs font-medium'>点击选择车架号根文件夹</p>
                      <p className='mt-1 text-[10px] text-muted-foreground'>子文件夹名作为登记车架号</p>
                    </div>
                  )}
                </div>

                <div className='flex flex-col justify-between md:col-span-2'>
                  <div className='rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground'>
                    每个子文件夹内优先读取文件名包含“合格证”的 PDF 或图片，OCR 后与子文件夹名中的车架号匹配。
                  </div>
                  <div className='mt-4 flex justify-end'>
                    <Button
                      onClick={startFolderOcrMatchProcess}
                      disabled={!folderPath || isMatching}
                      className='flex w-full items-center gap-2 sm:w-auto'
                    >
                      {isMatching ? (
                        <>
                          <RotateCcw className='h-4 w-4 animate-spin' />
                          正在比对 OCR...
                        </>
                      ) : (
                        <>
                          <Play className='h-4 w-4 fill-current' />
                          开始文件夹 OCR 匹配
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error Message Card */}
          {errorText && (
            <div className='rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-card-foreground shadow-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-200'>
              <div className='rounded-full bg-rose-500/20 p-1.5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0'>
                <XCircle className='h-5 w-5' />
              </div>
              <div className='flex-1 min-w-0'>
                <h4 className='text-sm font-bold text-rose-800 dark:text-rose-300'>比对运行错误提示</h4>
                <p className='text-xs font-mono text-muted-foreground mt-1 bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-rose-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-60'>
                  {errorText}
                </p>
                <p className='text-[10px] text-muted-foreground mt-1.5 leading-normal'>
                  Rust OCR 模型已随应用内置，无需配置 Python 环境。
                </p>
              </div>
            </div>
          )}

          {/* Export Output Card */}
          {outputPath && (
            <div className='rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-card-foreground shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4'>
              <div className='flex items-center gap-3'>
                <div className='rounded-full bg-emerald-500/20 p-2 text-emerald-600 dark:text-emerald-400'>
                  <CheckCircle className='h-6 w-6' />
                </div>
                <div>
                  <h4 className='text-sm font-bold text-emerald-800 dark:text-emerald-300'>车架号 OCR 匹配比对已完成！</h4>
                  <p className='text-xs text-muted-foreground mt-0.5 truncate max-w-[320px] sm:max-w-[450px]' title={outputPath}>
                    {matchMode === 'excel' ? '结果已成功写回原文件' : '结果 CSV 已生成'}，保存路径: {outputPath}
                  </p>
                </div>
              </div>
              <Button onClick={openOutputFolder} className='flex items-center gap-2 border border-emerald-500/30 hover:bg-emerald-500/10' variant='outline' size='sm'>
                <ExternalLink className='h-4 w-4' />
                在文件夹中打开
              </Button>
            </div>
          )}

          {/* Table Results Section */}
          {matchResults.length > 0 && (
            <div className='rounded-xl border bg-card p-5 text-card-foreground shadow-sm flex-1 flex flex-col min-h-[350px] overflow-hidden'>
              <div className='flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4 mb-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>
                  第二步：比对结果明细 ({filteredResults.length} / {matchResults.length})
                </h3>

                {/* Filter Controls */}
                <div className='flex flex-wrap items-center gap-2'>
                  <div className='relative w-48'>
                    <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                    <input
                      type='text'
                      placeholder='搜索姓名或车架号...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className='w-full rounded-md border border-input bg-background pl-9 pr-3 py-1.5 text-xs shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring'
                    />
                  </div>

                  <div className='flex rounded-md border p-0.5 bg-muted/50 text-xs'>
                    {[
                      { id: 'all', label: '全部' },
                      { id: '匹配', label: '匹配一致' },
                      { id: '不匹配', label: '不一致' },
                      { id: '匹配失败', label: '匹配失败' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setFilterStatus(tab.id)}
                        className={`px-3 py-1 rounded-sm font-medium transition-all ${
                          filterStatus === tab.id
                            ? 'bg-background shadow-xs text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Table wrapper */}
              <div className='flex-1 overflow-y-auto rounded-md border'>
                <table className='w-full border-collapse text-left text-sm'>
                  <thead>
                    <tr className='border-b bg-muted/50 text-xs font-semibold text-muted-foreground'>
                      <th className='p-3 w-16 text-center'>行号</th>
                      <th className='p-3 w-28'>姓名</th>
                      <th className='p-3'>登记车架号</th>
                      <th className='p-3'>OCR识别车架号</th>
                      <th className='p-3 w-32 text-center'>比对状态</th>
                      <th className='p-3 w-16 text-center'>操作</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {filteredResults.map((item) => {
                      const isExpanded = expandedRow === item.row
                      return (
                        <optgroup key={item.row} className='contents'>
                          <tr className='hover:bg-muted/40 transition-colors'>
                            <td className='p-3 text-center text-xs font-mono text-muted-foreground'>
                              {item.row}
                            </td>
                            <td className='p-3 font-medium text-xs'>{item.name}</td>
                            <td className='p-3 text-xs font-mono break-all'>{item.reg_vin || '—'}</td>
                            <td className='p-3 text-xs font-mono break-all'>{item.ocr_vin}</td>
                            <td className='p-3 text-center'>
                              {item.status === '匹配' ? (
                                <span className='inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'>
                                  <CheckCircle className='size-3' />
                                  匹配一致
                                </span>
                              ) : item.status === '不匹配' ? (
                                <span className='inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'>
                                  <XCircle className='size-3' />
                                  不一致
                                </span>
                              ) : (
                                <span className='inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'>
                                  <AlertTriangle className='size-3' />
                                  匹配失败
                                </span>
                              )}
                            </td>
                            <td className='p-3 text-center'>
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => setExpandedRow(isExpanded ? null : item.row)}
                              >
                                {isExpanded ? <ChevronUp className='size-4' /> : <ChevronDown className='size-4' />}
                              </Button>
                            </td>
                          </tr>

                          {/* Expanded Detail Panel */}
                          {isExpanded && (
                            <tr className='bg-muted/15'>
                              <td colSpan={6} className='p-4 border-t border-b divide-y divide-border/40'>
                                <div className='grid gap-4 md:grid-cols-2 text-xs'>
                                  <div>
                                    <h5 className='font-bold text-muted-foreground mb-1.5'>
                                      匹配与校验结果：
                                    </h5>
                                    <p className='font-mono break-all bg-muted/40 p-2 rounded-md border text-foreground/80 leading-relaxed'>
                                      登记重复: {item.reg_duplicate ? '是' : '否'}；OCR重复: {item.ocr_duplicate ? '是' : '否'}；匹配: {item.matched ? '是' : '否'}；登记17位: {item.reg_len_ok ? '是' : '否'}；OCR17位: {item.ocr_len_ok ? '是' : '否'}；登记校验码: {item.reg_check_ok ? '是' : '否'}；OCR校验码: {item.ocr_check_ok ? '是' : '否'}
                                    </p>
                                    <h5 className='mt-3 font-bold text-muted-foreground mb-1.5'>
                                      图片识别到的所有 17 位候选：
                                    </h5>
                                    <p className='font-mono break-all bg-muted/40 p-2 rounded-md border text-foreground/80 leading-relaxed'>
                                      {item.all_vins || '未识别到任何 17 位候选'}
                                    </p>
                                  </div>
                                  <div>
                                    <h5 className='font-bold text-muted-foreground mb-1.5'>
                                      图像识别出的前10行文本 (调试参考)：
                                    </h5>
                                    <p className='font-mono break-words bg-muted/40 p-2 rounded-md border text-[10px] text-foreground/75 leading-relaxed'>
                                      {item.texts_debug || '无识别到的文字'}
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </optgroup>
                      )
                    })}
                    {filteredResults.length === 0 && (
                      <tr>
                        <td colSpan={6} className='p-8 text-center text-muted-foreground text-xs'>
                          没有找到符合筛选条件的比对数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {outputPath && matchResults.length > 0 && (
            <div className='rounded-xl border bg-card p-5 text-card-foreground shadow-sm'>
              <h3 className='mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider'>
                第三步：{matchMode === 'excel' ? 'D列' : '文件夹'}校验汇总
              </h3>
              <div className='overflow-hidden rounded-md border'>
                <table className='w-full text-left text-sm'>
                  <thead className='border-b bg-muted/50 text-xs text-muted-foreground'>
                    <tr>
                      <th className='p-3'>条件</th>
                      <th className='p-3 text-center'>是</th>
                      <th className='p-3 text-center'>否</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {summaryRows.map((row) => (
                      <tr key={row.label}>
                        <td className='p-3 font-medium'>{row.label}</td>
                        <td className='p-3 text-center font-mono'>{row.yes}</td>
                        <td className='p-3 text-center font-mono'>{row.no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Main>
    </>
  )
}
