import { useState } from 'react';
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
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { ProfileDropdown } from '@/components/profile-dropdown';
import { ThemeSwitch } from '@/components/theme-switch';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

// (Tauri environment check is now performed dynamically via try/catch fallbacks)

interface FileEntry {
  name: string;
  path: string;
  type: 'pdf' | 'image' | 'excel' | 'word' | 'unknown';
  size_bytes: number;
}

interface VehicleFolder {
  name: string;
  path: string;
  files: FileEntry[];
}

interface ScanData {
  root_dir: string;
  vehicle_folders: VehicleFolder[];
  other_files: FileEntry[];
}

// Mock Data for Web Preview
const mockScanData: ScanData = {
  root_dir: "/Users/mock/WeChat/msg/file/2026-06/中交租赁&福清城投贸易第三期-福清用印(1)",
  vehicle_folders: [
    {
      name: "1-LS6CME0F7TB491297",
      path: "/mock/1-LS6CME0F7TB491297",
      files: [
        { name: "汽车买卖合同6042218122220000772228030-993-42.pdf", path: "/mock/1/contract.pdf", type: "pdf", size_bytes: 372315 },
        { name: "合格证.jpg", path: "/mock/1/hgz.jpg", type: "image", size_bytes: 3869692 }
      ]
    },
    {
      name: "2-LS5A2DKE2TA034208",
      path: "/mock/2-LS5A2DKE2TA034208",
      files: [
        { name: "汽车买卖合同6060813122720000761408827-993-59.pdf", path: "/mock/2/contract.pdf", type: "pdf", size_bytes: 373288 },
        { name: "合格证2.jpg", path: "/mock/2/hgz2.jpg", type: "image", size_bytes: 5127773 }
      ]
    },
    {
      name: "3-LGJE1EE09TN181872",
      path: "/mock/3-LGJE1EE09TN181872",
      files: [
        { name: "汽车买卖合同6060814042220000732715244-993-48.pdf", path: "/mock/3/contract.pdf", type: "pdf", size_bytes: 373019 },
        { name: "合格证.jpg", path: "/mock/3/hgz.jpg", type: "image", size_bytes: 3838221 }
      ]
    }
  ],
  other_files: [
    { name: "2 租赁物清单（不带合同金额）——确稿版第三批.xlsx", path: "/mock/2_list.xlsx", type: "excel", size_bytes: 11536 },
    { name: "3 销售折扣说明函(买卖共同出具)-审核.docx", path: "/mock/3_doc.docx", type: "word", size_bytes: 15604 },
    { name: "4 付款通知&收据——福清城投第3批.xls", path: "/mock/4_pay.xls", type: "excel", size_bytes: 28672 }
  ]
};

export default function FdrTool() {
  const [funder, setFunder] = useState<string>('zhongjiao');
  const [filePath, setFilePath] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [scanData, setScanData] = useState<ScanData | null>(null);
  
  // UI states
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, boolean>>({});
  const [mergeQueue, setMergeQueue] = useState<FileEntry[]>([]);
  const [exportName, setExportName] = useState<string>('中交租赁_福清城投贸易用印统一资料');
  const [statusText, setStatusText] = useState<string>('');

  const handleSelectFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{
          name: 'Archive Files',
          extensions: ['rar', 'zip']
        }]
      });

      if (selected && typeof selected === 'string') {
        setFilePath(selected);
        unzipAndScanFile(selected);
      }
    } catch (e: any) {
      console.warn("Tauri dialog failed, falling back to Web Mock:", e);
      toast.info("当前处于网页预览环境，已为您加载演示测试数据");
      loadData(mockScanData);
      setFilePath("Web_Preview_Mode_中交租赁&福清城投贸易第三期-福清用印(1).rar");
    }
  };

  // Call Rust to unzip and scan
  const unzipAndScanFile = async (path: string) => {
    setLoading(true);
    setStatusText('正在解压压缩包，请稍候...');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const jsonRes = await invoke<string>('unzip_and_scan', { 
        filePath: path, 
        outDir: "" // Empty tells Rust to use unique temp dir
      });
      
      const parsed = JSON.parse(jsonRes);
      if (parsed.status === 'success') {
        loadData(parsed.data);
        toast.success("成功解包并完成目录结构扫描");
      } else {
        toast.error(`扫描失败: ${parsed.message}`);
      }
    } catch (e: any) {
      toast.error(`处理失败: ${e.message || e}`);
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  // Load and pre-configure loaded file structure
  const loadData = (data: ScanData) => {
    setScanData(data);
    
    // Autoexpand all VIN folders by default
    const exp: Record<string, boolean> = {};
    data.vehicle_folders.forEach(v => {
      exp[v.name] = true;
    });
    setExpandedFolders(exp);

    // Prepare default selection and default sorting queue:
    // Order:
    // 1. Other files (Excel, Word) typically go first (like lease items list)
    // 2. Vehicle folders follow, sorted sequentially (1-..., 2-...)
    //    For each vehicle: Buy/Sell Contract (PDF) first, then Certificate (Image)
    const select: Record<string, boolean> = {};
    const queue: FileEntry[] = [];

    // Select vehicle files by default first (VIN folders)
    data.vehicle_folders.forEach(v => {
      v.files.forEach(f => {
        select[f.path] = true;
        queue.push(f);
      });
    });

    // Select other files by default next (non-vehicle root files)
    data.other_files.forEach(f => {
      select[f.path] = true;
      queue.push(f);
    });

    setSelectedFiles(select);
    setMergeQueue(queue);

    // Extract term/project name from filename to prepopulate output name
    if (filePath) {
      const baseName = filePath.split('/').pop()?.replace(/\.(rar|zip)$/i, '') || '';
      if (baseName) {
        setExportName(`${baseName}_用印统一资料`);
      }
    }
  };

  // Toggle single file selection
  const handleToggleFile = (file: FileEntry) => {
    const nextSelected = { ...selectedFiles, [file.path]: !selectedFiles[file.path] };
    setSelectedFiles(nextSelected);

    if (nextSelected[file.path]) {
      // Add to queue if not present
      if (!mergeQueue.some(q => q.path === file.path)) {
        setMergeQueue([...mergeQueue, file]);
      }
    } else {
      // Remove from queue
      setMergeQueue(mergeQueue.filter(q => q.path !== file.path));
    }
  };

  // Toggle entire vehicle folder selection
  const handleToggleFolder = (folder: VehicleFolder) => {
    const allSelected = folder.files.every(f => selectedFiles[f.path]);
    const nextSelected = { ...selectedFiles };
    
    folder.files.forEach(f => {
      nextSelected[f.path] = !allSelected;
    });
    setSelectedFiles(nextSelected);

    if (!allSelected) {
      // Add all to queue
      const toAdd = folder.files.filter(f => !mergeQueue.some(q => q.path === f.path));
      setMergeQueue([...mergeQueue, ...toAdd]);
    } else {
      // Remove all from queue
      const pathsToRemove = folder.files.map(f => f.path);
      setMergeQueue(mergeQueue.filter(q => !pathsToRemove.includes(q.path)));
    }
  };

  // Select / Deselect All
  const handleSelectAll = (select: boolean) => {
    if (!scanData) return;
    const nextSelected: Record<string, boolean> = {};
    const queue: FileEntry[] = [];

    if (select) {
      scanData.vehicle_folders.forEach(v => {
        v.files.forEach(f => {
          nextSelected[f.path] = true;
          queue.push(f);
        });
      });
      scanData.other_files.forEach(f => {
        nextSelected[f.path] = true;
        queue.push(f);
      });
    }

    setSelectedFiles(nextSelected);
    setMergeQueue(queue);
  };

  // Move items in merge queue
  const moveItem = (index: number, direction: 'up' | 'down' | 'top' | 'bottom') => {
    if (index < 0 || index >= mergeQueue.length) return;
    const newQueue = [...mergeQueue];
    const item = newQueue[index];
    
    if (direction === 'up' && index > 0) {
      newQueue[index] = newQueue[index - 1];
      newQueue[index - 1] = item;
    } else if (direction === 'down' && index < newQueue.length - 1) {
      newQueue[index] = newQueue[index + 1];
      newQueue[index + 1] = item;
    } else if (direction === 'top' && index > 0) {
      newQueue.splice(index, 1);
      newQueue.unshift(item);
    } else if (direction === 'bottom' && index < newQueue.length - 1) {
      newQueue.splice(index, 1);
      newQueue.push(item);
    }
    setMergeQueue(newQueue);
  };

  const handleExportPDF = async () => {
    if (mergeQueue.length === 0) {
      toast.warning("合并队列为空，请先勾选需要打包的文件");
      return;
    }

    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const outputSavePath = await save({
        defaultPath: `${exportName}.pdf`,
        filters: [{
          name: 'PDF Documents',
          extensions: ['pdf']
        }]
      });

      if (outputSavePath) {
        setLoading(true);
        setStatusText('正在转换图片与文档并合并成 PDF，这可能需要一点时间，请稍候...');
        
        const { invoke } = await import('@tauri-apps/api/core');
        
        // Pass array in JSON format
        const filesJson = JSON.stringify(mergeQueue.map(q => ({
          path: q.path,
          type: q.type
        })));

        await invoke<string>('generate_merged_pdf', {
          filesJson: filesJson,
          outputPath: outputSavePath,
          tempDir: scanData?.root_dir || ""
        });

        toast.success(`导出成功! 文件已保存至: ${outputSavePath}`);
      }
    } catch (e: any) {
      console.warn("Tauri PDF export failed, falling back to Web Mock:", e);
      toast.info("网页预览环境：成功合并导出 PDF (Mock) 到本地！");
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const getFormatIcon = (type: string) => {
    switch (type) {
      case 'pdf': return <FileText className="text-red-500 w-4 h-4" />;
      case 'image': return <FileText className="text-blue-500 w-4 h-4" />;
      case 'excel': return <FileText className="text-green-500 w-4 h-4" />;
      case 'word': return <FileText className="text-cyan-500 w-4 h-4" />;
      default: return <FileText className="text-gray-500 w-4 h-4" />;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <>
      <Header>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed className="flex flex-col gap-6 overflow-hidden">
        {/* Title */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
              <FolderArchive className="text-primary w-8 h-8" />
              FDR 资料统一打包工具
            </h1>
            <p className="text-muted-foreground mt-1">
              解压资方用印压缩包，对车架号子目录及附件进行自适应缩放、页面防溢出排序并拼接合并导出统一 PDF 文件。
            </p>
          </div>
        </div>

        <Separator className="shrink-0" />

        {/* Input / Control Panel */}
        <Card className="shrink-0 border bg-card/60 backdrop-blur-md">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              <div className="w-full lg:w-1/4 space-y-2">
                <label className="text-sm font-semibold flex items-center gap-1.5 block">
                  <CheckCircle className="w-4 h-4 text-primary" /> 选择资方
                </label>
                <Select value={funder} onValueChange={setFunder}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择资方" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zhongjiao">中交租赁</SelectItem>
                    <SelectItem value="others" disabled>其他资方（待扩充）</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full lg:w-3/4 space-y-2">
                <label className="text-sm font-semibold block">
                  选择打包压缩文件 (.rar / .zip)
                </label>
                <div className="flex gap-2">
                  <Input 
                    placeholder="尚未选择文件路径" 
                    value={filePath}
                    readOnly 
                    className="flex-1 cursor-default bg-muted"
                  />
                  <Button 
                    onClick={handleSelectFile} 
                    className="gap-2 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                    disabled={loading}
                  >
                    <FileUp className="w-4 h-4" />
                    {filePath ? '重新选择' : '浏览文件'}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center bg-background/55 backdrop-blur-sm gap-4 shrink-0 py-8 rounded-lg border border-dashed">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            <div className="text-center">
              <p className="font-semibold text-lg">{statusText}</p>
              <p className="text-sm text-muted-foreground mt-1">系统正在处理，这可能需要稍作等待...</p>
            </div>
          </div>
        )}

        {/* Loaded Data Panels */}
        {!loading && scanData && (
          <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0">
            {/* Left Panel: File Tree Scan View */}
            <div className="flex-1 flex flex-col min-h-0 bg-card rounded-xl border p-4">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  📁 解压文件结构预览
                </h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleSelectAll(true)}>全选</Button>
                  <Button variant="outline" size="sm" onClick={() => handleSelectAll(false)}>清空</Button>
                </div>
              </div>
              <Separator className="mb-4 shrink-0" />

              {/* Scrollable File List */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* 1. Other files (Lease documents, excel, docs) */}
                {scanData.other_files.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-2">
                      主合同与基础文件（非车架号子目录）
                    </h4>
                    <div className="bg-muted/40 rounded-lg p-2 border space-y-1.5">
                      {scanData.other_files.map((file) => (
                        <div 
                          key={file.path}
                          className="flex items-center gap-3 p-2 hover:bg-accent rounded-md cursor-pointer transition-colors"
                          onClick={() => handleToggleFile(file)}
                        >
                          <div className="shrink-0">
                            {selectedFiles[file.path] ? (
                              <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                          </div>
                          <div className="shrink-0">{getFormatIcon(file.type)}</div>
                          <div className="flex-1 min-w-0 text-sm font-medium truncate">{file.name}</div>
                          <div className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size_bytes)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Vehicle directory files */}
                {scanData.vehicle_folders.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-2">
                      按车架号 (VIN) 归档目录
                    </h4>
                    <div className="space-y-2">
                      {scanData.vehicle_folders.map((folder) => {
                        const allSelected = folder.files.every(f => selectedFiles[f.path]);
                        const isExpanded = expandedFolders[folder.name] ?? true;
                        
                        return (
                          <div key={folder.name} className="border rounded-lg bg-muted/20 overflow-hidden">
                            {/* Folder Title Header */}
                            <div className="flex items-center p-2.5 bg-muted/65 hover:bg-muted transition-colors cursor-pointer justify-between">
                              <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => handleToggleFolder(folder)}>
                                {allSelected ? (
                                  <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="font-bold text-sm truncate">{folder.name}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                                  {folder.files.length} 文件
                                </span>
                              </div>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="w-6 h-6 shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedFolders({ ...expandedFolders, [folder.name]: !isExpanded });
                                }}
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </Button>
                            </div>

                            {/* Sub files list */}
                            {isExpanded && (
                              <div className="p-2 bg-card border-t divide-y divide-muted/30">
                                {folder.files.map((file) => (
                                  <div 
                                    key={file.path}
                                    className="flex items-center gap-3 py-2 px-3 hover:bg-accent rounded-md cursor-pointer transition-colors"
                                    onClick={() => handleToggleFile(file)}
                                  >
                                    <div className="shrink-0">
                                      {selectedFiles[file.path] ? (
                                        <CheckSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                                      ) : (
                                        <Square className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                      )}
                                    </div>
                                    <div className="shrink-0">{getFormatIcon(file.type)}</div>
                                    <div className="flex-1 min-w-0 text-xs truncate">{file.name}</div>
                                    <div className="shrink-0 text-[10px] text-muted-foreground">{formatSize(file.size_bytes)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Merge Queue Order Control & Export */}
            <div className="flex-1 flex flex-col min-h-0 bg-card rounded-xl border p-4">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  📋 待合并打包队列 ({mergeQueue.length})
                </h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3 text-primary" /> 合并时图片自动缩放居中防溢出
                </span>
              </div>
              <Separator className="mb-4 shrink-0" />

              {/* Scrollable Merge Queue list */}
              {mergeQueue.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-8 border border-dashed rounded-lg">
                  <HelpCircle className="w-10 h-10 text-muted-foreground/50 mb-2" />
                  <p className="text-sm">请在左侧勾选文件以加入合并队列</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 mb-4">
                  {mergeQueue.map((item, idx) => (
                    <div 
                      key={item.path} 
                      className="flex items-center gap-3 p-2 bg-muted/40 hover:bg-muted/70 rounded-md border text-sm transition-all"
                    >
                      <span className="font-semibold text-xs text-muted-foreground w-5 shrink-0 text-right">
                        {idx + 1}
                      </span>
                      <div className="shrink-0">{getFormatIcon(item.type)}</div>
                      <div className="flex-1 min-w-0 font-medium text-xs truncate" title={item.name}>
                        {item.name}
                      </div>

                      {/* Direction adjust controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-6 h-6 hover:bg-accent" 
                          onClick={() => moveItem(idx, 'up')}
                          disabled={idx === 0}
                          title="上移"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-6 h-6 hover:bg-accent" 
                          onClick={() => moveItem(idx, 'down')}
                          disabled={idx === mergeQueue.length - 1}
                          title="下移"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Export panel footer */}
              {mergeQueue.length > 0 && (
                <div className="shrink-0 pt-3 border-t space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground block">
                      自定义导出 PDF 文件名称
                    </label>
                    <div className="flex gap-2">
                      <Input 
                        placeholder="请输入导出名称"
                        value={exportName}
                        onChange={(e) => setExportName(e.target.value)}
                        className="text-sm font-medium"
                      />
                      <span className="self-center font-bold text-sm text-muted-foreground">.pdf</span>
                    </div>
                  </div>

                  <Button 
                    onClick={handleExportPDF} 
                    className="w-full gap-2 text-primary-foreground font-semibold py-5 bg-primary hover:bg-primary/95 text-base shadow-lg transition-transform hover:scale-[1.01]"
                  >
                    <Download className="w-5 h-5" />
                    一键合并导出统一 PDF
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty status placeholder */}
        {!loading && !scanData && (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed rounded-xl p-8 bg-card/10 shrink-0 py-16">
            <FolderArchive className="w-16 h-16 text-muted-foreground/30 mb-3 animate-pulse" />
            <h3 className="font-bold text-xl mb-1">请选择您的资方与资料包</h3>
            <p className="text-muted-foreground text-sm max-w-md text-center mb-6">
              请在上方选择处理资方，并浏览载入对应的 `.rar` 或 `.zip` 压缩文件，系统将自动帮您分类和重组打包。
            </p>
            <Button onClick={handleSelectFile} size="lg" className="gap-2 font-medium">
              <FileUp className="w-5 h-5" />
              浏览载入压缩文件
            </Button>
          </div>
        )}
      </Main>
    </>
  );
}
