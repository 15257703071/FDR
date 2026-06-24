# 🤖 项目 AI 开发协作规范 (AGENTS.md)

本文件是本项目（通用后台 Starter）的 AI 协同开发规约，用以约束 AI 助手在后续开发新需求时，能够保持**相同的样式标准**、**统一的命令控制**以及**清晰的系统架构**。

---

## 🎨 1. UI/UX 美学与样式规范

*   **技术栈约束**：本项目核心使用 **React 19**、**TailwindCSS v4** (通过 `@tailwindcss/vite` 插件接入) 以及 **shadcn-ui / Radix UI** 组件库。
*   **设计系统一致性**：
    *   **颜色与主题**：统一使用 CSS 变量（如 `var(--primary)`, `var(--background)`, `var(--muted)` 等），确保完美支持浅色（Light）与深色（Dark）模式。
    *   **手写样式禁令**：**严禁**在 JSX 中手写任意的 Hex/RGB 颜色代码（如 `bg-[#1a1a2e]`）或非系统圆角等。所有新组件必须复用或扩展 `components/ui/` 下的 shadcn 原生组件，或使用系统定义的 Tailwind 语义化类。
    *   **精致美学**：界面风格提倡现代高级感（Sleek Minimalism / Glassmorphism）。可以使用细微的 Hover 缩放动画、平滑过渡（`transition-all duration-200`）、毛玻璃背景（`bg-background/80 backdrop-blur-md`）及柔和的半透明阴影（`shadow-sm`）。
*   **组件重用优先**：开发新页面前，先审查 `src/components/ui/` 目录，优先组合现有的 UI 基础原子组件，严禁重复造轮子。

---

## 📂 2. 文件结构与路由规范

项目采用逻辑特征（Features）与路由目录分离的清晰架构：
*   **业务逻辑放置区**：所有具体页面的逻辑、表单、专有子组件必须存放在 `src/features/[feature-name]/` 目录下。
*   **文件系统路由区**：页面路由的入口文件存放于 `src/routes/` 下，直接与访问路径相匹配。
    *   需要鉴权访问的后台页面，放在 `src/routes/_authenticated/` 下。
    *   无需鉴权的认证页面（如登录/注册/错误页），放在 `src/routes/(auth)/` 或 `src/routes/(errors)/` 下。
*   **路由定义写法**：路由文件应极其简洁，仅做底层组件导入与路由挂载：
    ```typescript
    import { createFileRoute } from '@tanstack/react-router'
    import { MyFeature } from '@/features/my-feature'

    export const Route = createFileRoute('/_authenticated/my-feature')({
      component: MyFeature,
    })
    ```
*   **路由树生成禁令**：**绝对禁止**手动修改或直接编辑 [routeTree.gen.ts](file:///Users/jiebo/work/learn/0606-new-prd/shadcn-admin/src/routeTree.gen.ts)。当新增、删除或移动 `src/routes/` 下的文件后，通过启动运行开发命令或打包构建命令，让 `@tanstack/router-plugin` 插件在编译时自动生成该文件。

---

## 💻 3. 统一命令与开发规范

所有终端操作和依赖管理均需统一使用 `pnpm` 包管理器：
*   **本地开发运行**：`pnpm dev`
*   **生产环境编译构建**（包含 TypeScript 强类型校验）：`pnpm run build`
*   **代码格式化校验**：`pnpm run format` (使用 Prettier 自动修复整个项目格式)
*   **Eslint 静态检测**：`pnpm run lint`
*   **依赖包操作**：新增依赖使用 `pnpm add <pkg_name>`，移除无用包使用 `pnpm remove <pkg_name>`。安装新依赖后，必须重新运行打包构建检查有无冲突。

---

## 💬 4. 交互与协作原则

*   **交互语言**：AI 在向用户进行工作汇报、进度说明、问题确认时，**必须默认使用中文**。
*   **Subagent 限制**：在复杂需求重构时，同一轮任务中最多启动 **2 个** 浏览器或代码子代理（subagent），由主 agent 统一对最终打包构建成功和功能正确性负责。
*   **修改代码后的验证**：AI 修改任意代码后，**必须自主运行** `pnpm run build`，确保没有发生类型报错且打包成功，方可视为任务交付。
