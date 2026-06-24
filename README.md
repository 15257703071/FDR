# FDR 资料统一打包工具 (Tauri 桌面端应用)

本工具是一个基于 **Tauri (React + Rust)** 架构和 **Python** 文件处理核心开发的跨平台桌面端应用，旨在帮助用户快速、无损地打包并整合多资方（目前为：**中交租赁**）的用印贸易资料。

---

## 🌟 主要功能

- 📦 **压缩包一键解压**：支持直接加载 `.rar` 或 `.zip` 格式的微信附件包，使用高兼容性命令行一键在系统临时目录解包。
- 🚗 **车架号目录智能扫描**：自动递归扫描解压后的文件夹树，智能提取各车架号（VIN）文件夹下的资料（买卖合同 PDF、合格证 JPG 等）进行结构化分类。
- 🖼️ **防溢出图像自适应 PDF 转换**：基于 PIL 和 reportlab 对图片进行 A4 比例换算，对于过大或分辨率不符的合格证图片自动进行等比居中缩小并留有页边距，杜绝内容截断和画面超出 PDF 页面的情况。
- 📊 **Excel/Word 文档无损转换**：自动调用系统内置的 `LibreOffice` 引擎将租赁物清单（Excel）和销售折扣函（Word）静默转换为 PDF 页；对于未安装环境的用户，提供纯 Python 代码简易转换作为降级保护。
- 🔀 **自定义打包与排序**：前端提供了简洁的树级展示，用户可自由勾选需要合并的文件，在待打包队列中支持一键置顶、置底或上移下移，支持自定义导出 PDF 文件名。

---

## 🛠️ 系统环境依赖 (macOS)

为了在本地获得最佳的解压与 Office 转换效果，请确保您的 Mac 上已安装以下依赖工具（均可通过 Homebrew 快速安装）：

1. **Rar 格式解压支持**：
   ```bash
   brew install unar
   ```
2. **Office 转 PDF 完美渲染支持**：
   ```bash
   brew install --cask libreoffice
   ```
3. **Python 3 核心处理库**：
   ```bash
   pip3 install pillow reportlab pypdf
   ```

---

## 🚀 开发与启动

在运行或开发前，请先确保已安装 Node.js 与 `pnpm`：

1. **安装前端依赖**：
   ```bash
   pnpm install
   ```

2. **在浏览器中预览前端页面 (开发调试 UI)**：
   项目内置了 Mock 数据保护。在没有 Tauri 环境的纯 H5 浏览器中预览时，会自动加载模拟的微信用印资料，方便直接调试界面交互：
   ```bash
   pnpm dev
   ```

3. **启动 Tauri 桌面应用 (开发调试完整功能)**：
   运行该命令将拉起 Tauri 桌面端容器，支持完整的 Rust 调用、本地文件选择器、以及后台 Python 处理逻辑：
   ```bash
   pnpm tauri dev
   ```

---

## 📦 应用打包发布

当开发完毕需要分发给其他用户时，可直接打包生成 macOS 平台标准的安装包：

1. **执行 Tauri 一键打包**：
   ```bash
   pnpm tauri build
   ```

2. **获取安装包**：
   打包完成后，可在项目根目录下的以下路径找到分发的磁盘映像文件（.dmg）或应用程序（.app）：
   - **DMG 安装包**：`src-tauri/target/release/bundle/dmg/`
   - **APP 应用程序**：`src-tauri/target/release/bundle/macos/`
