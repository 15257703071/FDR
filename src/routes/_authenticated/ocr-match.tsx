import { createFileRoute } from '@tanstack/react-router'
import { OcrMatch } from '@/features/ocr-match'

export const Route = createFileRoute('/_authenticated/ocr-match')({
  component: OcrMatch,
})
