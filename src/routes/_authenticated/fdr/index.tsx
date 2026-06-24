import { createFileRoute } from '@tanstack/react-router'
import FdrTool from '@/features/fdr/fdr-tool'

export const Route = createFileRoute('/_authenticated/fdr/')({
  component: FdrTool,
})
