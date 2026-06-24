import {
  Construction,
  LayoutDashboard,
  Monitor,
  Bug,
  FileX,
  Lock,
  Bell,
  Palette,
  ServerOff,
  Settings,
  Wrench,
  UserCog,
  UserX,
  ShieldCheck,
  AudioWaveform,
  Command,
  GalleryVerticalEnd,
  FileArchive,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'satnaing',
    email: 'satnaingdev@gmail.com',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'Shadcn Admin',
      logo: Command,
      plan: 'Vite + ShadcnUI',
    },
    {
      name: 'Acme Inc',
      logo: GalleryVerticalEnd,
      plan: 'Enterprise',
    },
    {
      name: 'Acme Corp.',
      logo: AudioWaveform,
      plan: 'Startup',
    },
  ],
  navGroups: [
    {
      title: '常规',
      items: [
        {
          title: '控制台',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'FDR 资料统一打包',
          url: '/fdr',
          icon: FileArchive,
        },
      ],
    },
    {
      title: '页面演示',
      items: [
        {
          title: '身份验证',
          icon: ShieldCheck,
          items: [
            {
              title: '登录',
              url: '/sign-in',
            },
            {
              title: '注册',
              url: '/sign-up',
            },
            {
              title: '找回密码',
              url: '/forgot-password',
            },
          ],
        },
        {
          title: '错误页面',
          icon: Bug,
          items: [
            {
              title: '未授权 (401)',
              url: '/errors/unauthorized',
              icon: Lock,
            },
            {
              title: '无权限 (403)',
              url: '/errors/forbidden',
              icon: UserX,
            },
            {
              title: '页面未找到 (404)',
              url: '/errors/not-found',
              icon: FileX,
            },
            {
              title: '服务器错误 (500)',
              url: '/errors/internal-server-error',
              icon: ServerOff,
            },
            {
              title: '系统维护 (503)',
              url: '/errors/maintenance-error',
              icon: Construction,
            },
          ],
        },
      ],
    },
    {
      title: '系统设置',
      items: [
        {
          title: '配置中心',
          icon: Settings,
          items: [
            {
              title: '个人信息',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: '账户设置',
              url: '/settings/account',
              icon: Wrench,
            },
            {
              title: '外观设置',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              title: '通知设置',
              url: '/settings/notifications',
              icon: Bell,
            },
            {
              title: '显示设置',
              url: '/settings/display',
              icon: Monitor,
            },
          ],
        },
      ],
    },
  ],
}
