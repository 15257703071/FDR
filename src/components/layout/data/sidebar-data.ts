import { Settings, Command, FileArchive, FileText } from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'satnaing',
    email: 'satnaingdev@gmail.com',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: '金融部小工具',
      logo: Command,
      plan: 'FDR 资料打包',
    },
  ],
  navGroups: [
    {
      title: '常规',
      items: [
        {
          title: 'FDR 资料统一打包',
          url: '/fdr',
          icon: FileArchive,
        },
        {
          title: '车架号 OCR 匹配',
          url: '/ocr-match',
          icon: FileText,
        },
        {
          title: '系统设置',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
