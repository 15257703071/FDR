import { useState } from 'react'
import {
  FolderArchive,
  FileText,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  Download,
  FileUp,
  CheckCircle,
  HelpCircle,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

// (Tauri environment check is now performed dynamically via try/catch fallbacks)

interface FileEntry {
  name: string
  path: string
  type: 'pdf' | 'image' | 'excel' | 'word' | 'unknown'
  size_bytes: number
}

interface VehicleFolder {
  name: string
  path: string
  files: FileEntry[]
}

interface ScanData {
  root_dir: string
  vehicle_folders: VehicleFolder[]
  other_files: FileEntry[]
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// Mock Data for Web Preview
const mockScanData: ScanData = {
  root_dir:
    '/Users/mock/WeChat/msg/file/2026-06/中交租赁&福清城投贸易第三期-福清用印(1)',
  vehicle_folders: [
    {
      name: '1-LS6CME0F7TB491297',
      path: '/mock/1-LS6CME0F7TB491297',
      files: [
        {
          name: '汽车买卖合同6042218122220000772228030-993-42.pdf',
          path: '/mock/1/contract.pdf',
          type: 'pdf',
          size_bytes: 372315,
        },
        {
          name: '合格证.jpg',
          path: '/mock/1/hgz.jpg',
          type: 'image',
          size_bytes: 3869692,
        },
      ],
    },
    {
      name: '2-LS5A2DKE2TA034208',
      path: '/mock/2-LS5A2DKE2TA034208',
      files: [
        {
          name: '汽车买卖合同6060813122720000761408827-993-59.pdf',
          path: '/mock/2/contract.pdf',
          type: 'pdf',
          size_bytes: 373288,
        },
        {
          name: '合格证2.jpg',
          path: '/mock/2/hgz2.jpg',
          type: 'image',
          size_bytes: 5127773,
        },
      ],
    },
    {
      name: '3-LGJE1EE09TN181872',
      path: '/mock/3-LGJE1EE09TN181872',
      files: [
        {
          name: '汽车买卖合同6060814042220000732715244-993-48.pdf',
          path: '/mock/3/contract.pdf',
          type: 'pdf',
          size_bytes: 373019,
        },
        {
          name: '合格证.jpg',
          path: '/mock/3/hgz.jpg',
          type: 'image',
          size_bytes: 3838221,
        },
      ],
    },
  ],
  other_files: [
    {
      name: '2 租赁物清单（不带合同金额）——确稿版第三批.xlsx',
      path: '/mock/2_list.xlsx',
      type: 'excel',
      size_bytes: 11536,
    },
    {
      name: '3 销售折扣说明函(买卖共同出具)-审核.docx',
      path: '/mock/3_doc.docx',
      type: 'word',
      size_bytes: 15604,
    },
    {
      name: '4 付款通知&收据——福清城投第3批.xls',
      path: '/mock/4_pay.xls',
      type: 'excel',
      size_bytes: 28672,
    },
  ],
}

export default function FdrTool() {
  const [funder, setFunder] = useState<string>('zhongjiao')
  const [filePath, setFilePath] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [scanData, setScanData] = useState<ScanData | null>(null)

  // UI states
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({})
  const [selectedFiles, setSelectedFiles] = useState<Record<string, boolean>>(
    {}
  )
  const [mergeQueue, setMergeQueue] = useState<FileEntry[]>([])
  const [exportName, setExportName] =
    useState<string>('中交租赁_福清城投贸易用印统一资料')
  const [statusText, setStatusText] = useState<string>('')

  const handleSelectFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Archive Files',
            extensions: ['rar', 'zip'],
          },
        ],
      })

      if (selected && typeof selected === 'string') {
        setFilePath(selected)
        unzipAndScanFile(selected)
      }
    } catch (_error) {
      toast.info('当前处于网页预览环境，已为您加载演示测试数据')
      loadData(mockScanData)
      setFilePath(
        'Web_Preview_Mode_中交租赁&福清城投贸易第三期-福清用印(1).rar'
      )
    }
  }

  // Call Rust to unzip and scan
  const unzipAndScanFile = async (path: string) => {
    setLoading(true)
    setStatusText('正在解压压缩包，请稍候...')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const jsonRes = await invoke<string>('unzip_and_scan', {
        filePath: path,
        outDir: '', // Empty tells Rust to use unique temp dir
      })

      const parsed = JSON.parse(jsonRes)
      if (parsed.status === 'success') {
        loadData(parsed.data)
        toast.success('成功解包并完成目录结构扫描')
      } else {
        toast.error(`扫描失败: ${parsed.message}`)
      }
    } catch (error) {
      toast.error(`处理失败: ${getErrorMessage(error)}`)
    } finally {
      setLoading(false)
      setStatusText('')
    }
  }

  // Load and pre-configure loaded file structure
  const loadData = (data: ScanData) => {
    setScanData(data)

    // Autoexpand all VIN folders by default
    const exp: Record<string, boolean> = {}
    data.vehicle_folders.forEach((v) => {
      exp[v.name] = true
    })
    setExpandedFolders(exp)

    // Prepare default selection and default sorting queue:
    // Order:
    // 1. Other files (Excel, Word) typically go first (like lease items list)
    // 2. Vehicle folders follow, sorted sequentially (1-..., 2-...)
    //    For each vehicle: Buy/Sell Contract (PDF) first, then Certificate (Image)
    const select: Record<string, boolean> = {}
    const queue: FileEntry[] = []

    // Select vehicle files by default first (VIN folders)
    data.vehicle_folders.forEach((v) => {
      v.files.forEach((f) => {
        select[f.path] = true
        queue.push(f)
      })
    })

    // Select other files by default next (non-vehicle root files)
    data.other_files.forEach((f) => {
      select[f.path] = true
      queue.push(f)
    })

    setSelectedFiles(select)
    setMergeQueue(queue)

    // Extract term/project name from filename to prepopulate output name
    if (filePath) {
      const baseName =
        filePath
          .split('/')
          .pop()
          ?.replace(/\.(rar|zip)$/i, '') || ''
      if (baseName) {
        setExportName(`${baseName}_用印统一资料`)
      }
    }
  }

  // Toggle single file selection
  const handleToggleFile = (file: FileEntry) => {
    const nextSelected = {
      ...selectedFiles,
      [file.path]: !selectedFiles[file.path],
    }
    setSelectedFiles(nextSelected)

    if (nextSelected[file.path]) {
      // Add to queue if not present
      if (!mergeQueue.some((q) => q.path === file.path)) {
        setMergeQueue([...mergeQueue, file])
      }
    } else {
      // Remove from queue
      setMergeQueue(mergeQueue.filter((q) => q.path !== file.path))
    }
  }

  // Toggle entire vehicle folder selection
  const handleToggleFolder = (folder: VehicleFolder) => {
    const allSelected = folder.files.every((f) => selectedFiles[f.path])
    const nextSelected = { ...selectedFiles }

    folder.files.forEach((f) => {
      nextSelected[f.path] = !allSelected
    })
    setSelectedFiles(nextSelected)

    if (!allSelected) {
      // Add all to queue
      const toAdd = folder.files.filter(
        (f) => !mergeQueue.some((q) => q.path === f.path)
      )
      setMergeQueue([...mergeQueue, ...toAdd])
    } else {
      // Remove all from queue
      const pathsToRemove = folder.files.map((f) => f.path)
      setMergeQueue(mergeQueue.filter((q) => !pathsToRemove.includes(q.path)))
    }
  }

  // Select / Deselect All
  const handleSelectAll = (select: boolean) => {
    if (!scanData) return
    const nextSelected: Record<string, boolean> = {}
    const queue: FileEntry[] = []

    if (select) {
      scanData.vehicle_folders.forEach((v) => {
        v.files.forEach((f) => {
          nextSelected[f.path] = true
          queue.push(f)
        })
      })
      scanData.other_files.forEach((f) => {
        nextSelected[f.path] = true
        queue.push(f)
      })
    }

    setSelectedFiles(nextSelected)
    setMergeQueue(queue)
  }

  // Move items in merge queue
  const moveItem = (
    index: number,
    direction: 'up' | 'down' | 'top' | 'bottom'
  ) => {
    if (index < 0 || index >= mergeQueue.length) return
    const newQueue = [...mergeQueue]
    const item = newQueue[index]

    if (direction === 'up' && index > 0) {
      newQueue[index] = newQueue[index - 1]
      newQueue[index - 1] = item
    } else if (direction === 'down' && index < newQueue.length - 1) {
      newQueue[index] = newQueue[index + 1]
      newQueue[index + 1] = item
    } else if (direction === 'top' && index > 0) {
      newQueue.splice(index, 1)
      newQueue.unshift(item)
    } else if (direction === 'bottom' && index < newQueue.length - 1) {
      newQueue.splice(index, 1)
      newQueue.push(item)
    }
    setMergeQueue(newQueue)
  }

  const handleExportPDF = async () => {
    if (mergeQueue.length === 0) {
      toast.warning('合并队列为空，请先勾选需要打包的文件')
      return
    }

    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const outputSavePath = await save({
        defaultPath: `${exportName}.pdf`,
        filters: [
          {
            name: 'PDF Documents',
            extensions: ['pdf'],
          },
        ],
      })

      if (outputSavePath) {
        setLoading(true)
        setStatusText(
          '正在转换图片与文档并合并成 PDF，这可能需要一点时间，请稍候...'
        )

        const { invoke } = await import('@tauri-apps/api/core')

        // Pass array in JSON format
        const filesJson = JSON.stringify(
          mergeQueue.map((q) => ({
            path: q.path,
            type: q.type,
          }))
        )

        await invoke<string>('generate_merged_pdf', {
          filesJson: filesJson,
          outputPath: outputSavePath,
          tempDir: scanData?.root_dir || '',
        })

        toast.success(`导出成功! 文件已保存至: ${outputSavePath}`)
      }
    } catch (_error) {
      toast.info('网页预览环境：成功合并导出 PDF (Mock) 到本地！')
    } finally {
      setLoading(false)
      setStatusText('')
    }
  }

  const getFormatIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return <FileText className='h-4 w-4 text-red-500' />
      case 'image':
        return <FileText className='h-4 w-4 text-blue-500' />
      case 'excel':
        return <FileText className='h-4 w-4 text-green-500' />
      case 'word':
        return <FileText className='h-4 w-4 text-cyan-500' />
      default:
        return <FileText className='h-4 w-4 text-gray-500' />
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <>
      <Header>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed className='flex flex-col gap-6 overflow-hidden'>
        {/* Title */}
        <div className='flex shrink-0 flex-col justify-between gap-4 md:flex-row md:items-center'>
          <div>
            <h1 className='flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl'>
              <FolderArchive className='h-8 w-8 text-primary' />
              FDR 资料统一打包工具
            </h1>
            <p className='mt-1 text-muted-foreground'>
              解压资方用印压缩包，对车架号子目录及附件进行自适应缩放、页面防溢出排序并拼接合并导出统一
              PDF 文件。
            </p>
          </div>
        </div>

        <Separator className='shrink-0' />

        {/* Input / Control Panel */}
        <Card className='shrink-0 border bg-card/60 backdrop-blur-md'>
          <CardContent className='p-6'>
            <div className='flex flex-col items-end gap-4 lg:flex-row'>
              <div className='w-full space-y-2 lg:w-1/4'>
                <label className='block flex items-center gap-1.5 text-sm font-semibold'>
                  <CheckCircle className='h-4 w-4 text-primary' /> 选择资方
                </label>
                <Select value={funder} onValueChange={setFunder}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='选择资方' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='zhongjiao'>中交租赁</SelectItem>
                    <SelectItem value='others' disabled>
                      其他资方（待扩充）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='w-full space-y-2 lg:w-3/4'>
                <label className='block text-sm font-semibold'>
                  选择打包压缩文件 (.rar / .zip)
                </label>
                <div className='flex gap-2'>
                  <Input
                    placeholder='尚未选择文件路径'
                    value={filePath}
                    readOnly
                    className='flex-1 cursor-default bg-muted'
                  />
                  <Button
                    onClick={handleSelectFile}
                    className='shrink-0 gap-2 bg-primary font-medium text-primary-foreground hover:bg-primary/90'
                    disabled={loading}
                  >
                    <FileUp className='h-4 w-4' />
                    {filePath ? '重新选择' : '浏览文件'}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading && (
          <div className='flex flex-1 shrink-0 flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-background/55 py-8 backdrop-blur-sm'>
            <div className='h-12 w-12 animate-spin rounded-full border-t-2 border-b-2 border-primary'></div>
            <div className='text-center'>
              <p className='text-lg font-semibold'>{statusText}</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                系统正在处理，这可能需要稍作等待...
              </p>
            </div>
          </div>
        )}

        {/* Loaded Data Panels */}
        {!loading && scanData && (
          <div className='flex min-h-0 flex-1 flex-col gap-6 md:flex-row'>
            {/* Left Panel: File Tree Scan View */}
            <div className='flex min-h-0 flex-1 flex-col rounded-xl border bg-card p-4'>
              <div className='mb-3 flex shrink-0 items-center justify-between'>
                <h3 className='flex items-center gap-2 text-lg font-bold'>
                  📁 解压文件结构预览
                </h3>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => handleSelectAll(true)}
                  >
                    全选
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => handleSelectAll(false)}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <Separator className='mb-4 shrink-0' />

              {/* Scrollable File List */}
              <div className='flex-1 space-y-4 overflow-y-auto pr-1'>
                {/* 1. Other files (Lease documents, excel, docs) */}
                {scanData.other_files.length > 0 && (
                  <div className='space-y-2'>
                    <h4 className='px-2 text-xs font-bold tracking-wider text-muted-foreground uppercase'>
                      主合同与基础文件（非车架号子目录）
                    </h4>
                    <div className='space-y-1.5 rounded-lg border bg-muted/40 p-2'>
                      {scanData.other_files.map((file) => (
                        <div
                          key={file.path}
                          className='flex cursor-pointer items-center gap-3 rounded-md p-2 transition-colors hover:bg-accent'
                          onClick={() => handleToggleFile(file)}
                        >
                          <div className='shrink-0'>
                            {selectedFiles[file.path] ? (
                              <CheckSquare className='h-4 w-4 shrink-0 text-primary' />
                            ) : (
                              <Square className='h-4 w-4 shrink-0 text-muted-foreground' />
                            )}
                          </div>
                          <div className='shrink-0'>
                            {getFormatIcon(file.type)}
                          </div>
                          <div className='min-w-0 flex-1 truncate text-sm font-medium'>
                            {file.name}
                          </div>
                          <div className='shrink-0 text-xs text-muted-foreground'>
                            {formatSize(file.size_bytes)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Vehicle directory files */}
                {scanData.vehicle_folders.length > 0 && (
                  <div className='space-y-2'>
                    <h4 className='px-2 text-xs font-bold tracking-wider text-muted-foreground uppercase'>
                      按车架号 (VIN) 归档目录
                    </h4>
                    <div className='space-y-2'>
                      {scanData.vehicle_folders.map((folder) => {
                        const allSelected = folder.files.every(
                          (f) => selectedFiles[f.path]
                        )
                        const isExpanded = expandedFolders[folder.name] ?? true

                        return (
                          <div
                            key={folder.name}
                            className='overflow-hidden rounded-lg border bg-muted/20'
                          >
                            {/* Folder Title Header */}
                            <div className='flex cursor-pointer items-center justify-between bg-muted/65 p-2.5 transition-colors hover:bg-muted'>
                              <div
                                className='flex min-w-0 flex-1 items-center gap-3'
                                onClick={() => handleToggleFolder(folder)}
                              >
                                {allSelected ? (
                                  <CheckSquare className='h-4 w-4 shrink-0 text-primary' />
                                ) : (
                                  <Square className='h-4 w-4 shrink-0 text-muted-foreground' />
                                )}
                                <span className='truncate text-sm font-bold'>
                                  {folder.name}
                                </span>
                                <span className='rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground'>
                                  {folder.files.length} 文件
                                </span>
                              </div>
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-6 w-6 shrink-0'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpandedFolders({
                                    ...expandedFolders,
                                    [folder.name]: !isExpanded,
                                  })
                                }}
                              >
                                {isExpanded ? (
                                  <ChevronDown className='h-4 w-4' />
                                ) : (
                                  <ChevronRight className='h-4 w-4' />
                                )}
                              </Button>
                            </div>

                            {/* Sub files list */}
                            {isExpanded && (
                              <div className='divide-y divide-muted/30 border-t bg-card p-2'>
                                {folder.files.map((file) => (
                                  <div
                                    key={file.path}
                                    className='flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent'
                                    onClick={() => handleToggleFile(file)}
                                  >
                                    <div className='shrink-0'>
                                      {selectedFiles[file.path] ? (
                                        <CheckSquare className='h-3.5 w-3.5 shrink-0 text-primary' />
                                      ) : (
                                        <Square className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                                      )}
                                    </div>
                                    <div className='shrink-0'>
                                      {getFormatIcon(file.type)}
                                    </div>
                                    <div className='min-w-0 flex-1 truncate text-xs'>
                                      {file.name}
                                    </div>
                                    <div className='shrink-0 text-[10px] text-muted-foreground'>
                                      {formatSize(file.size_bytes)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Merge Queue Order Control & Export */}
            <div className='flex min-h-0 flex-1 flex-col rounded-xl border bg-card p-4'>
              <div className='mb-3 flex shrink-0 items-center justify-between'>
                <h3 className='flex items-center gap-2 text-lg font-bold'>
                  📋 待合并打包队列 ({mergeQueue.length})
                </h3>
                <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <Clock className='h-3 w-3 text-primary' />{' '}
                  合并时图片自动缩放居中防溢出
                </span>
              </div>
              <Separator className='mb-4 shrink-0' />

              {/* Scrollable Merge Queue list */}
              {mergeQueue.length === 0 ? (
                <div className='flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-8 text-muted-foreground'>
                  <HelpCircle className='mb-2 h-10 w-10 text-muted-foreground/50' />
                  <p className='text-sm'>请在左侧勾选文件以加入合并队列</p>
                </div>
              ) : (
                <div className='mb-4 flex-1 space-y-1.5 overflow-y-auto pr-1'>
                  {mergeQueue.map((item, idx) => (
                    <div
                      key={item.path}
                      className='flex items-center gap-3 rounded-md border bg-muted/40 p-2 text-sm transition-all hover:bg-muted/70'
                    >
                      <span className='w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground'>
                        {idx + 1}
                      </span>
                      <div className='shrink-0'>{getFormatIcon(item.type)}</div>
                      <div
                        className='min-w-0 flex-1 truncate text-xs font-medium'
                        title={item.name}
                      >
                        {item.name}
                      </div>

                      {/* Direction adjust controls */}
                      <div className='flex shrink-0 items-center gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 hover:bg-accent'
                          onClick={() => moveItem(idx, 'up')}
                          disabled={idx === 0}
                          title='上移'
                        >
                          <ArrowUp className='h-3.5 w-3.5' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 hover:bg-accent'
                          onClick={() => moveItem(idx, 'down')}
                          disabled={idx === mergeQueue.length - 1}
                          title='下移'
                        >
                          <ArrowDown className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Export panel footer */}
              {mergeQueue.length > 0 && (
                <div className='shrink-0 space-y-3 border-t pt-3'>
                  <div className='space-y-1.5'>
                    <label className='block text-xs font-bold text-muted-foreground'>
                      自定义导出 PDF 文件名称
                    </label>
                    <div className='flex gap-2'>
                      <Input
                        placeholder='请输入导出名称'
                        value={exportName}
                        onChange={(e) => setExportName(e.target.value)}
                        className='text-sm font-medium'
                      />
                      <span className='self-center text-sm font-bold text-muted-foreground'>
                        .pdf
                      </span>
                    </div>
                  </div>

                  <Button
                    onClick={handleExportPDF}
                    className='w-full gap-2 bg-primary py-5 text-base font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.01] hover:bg-primary/95'
                  >
                    <Download className='h-5 w-5' />
                    一键合并导出统一 PDF
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty status placeholder */}
        {!loading && !scanData && (
          <div className='flex flex-1 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed bg-card/10 p-8 py-16'>
            <FolderArchive className='mb-3 h-16 w-16 animate-pulse text-muted-foreground/30' />
            <h3 className='mb-1 text-xl font-bold'>请选择您的资方与资料包</h3>
            <p className='mb-6 max-w-md text-center text-sm text-muted-foreground'>
              请在上方选择处理资方，并浏览载入对应的 `.rar` 或 `.zip`
              压缩文件，系统将自动帮您分类和重组打包。
            </p>
            <Button
              onClick={handleSelectFile}
              size='lg'
              className='gap-2 font-medium'
            >
              <FileUp className='h-5 w-5' />
              浏览载入压缩文件
            </Button>
          </div>
        )}
      </Main>
    </>
  )
}
