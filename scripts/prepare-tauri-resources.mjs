import {
  accessSync,
  constants,
  cpSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const binDir = join(root, 'src-tauri', 'bin')
const loDir = join(root, 'src-tauri', 'vendor', 'libreoffice')

mkdirSync(binDir, { recursive: true })
mkdirSync(loDir, { recursive: true })

const exists = (path) => {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

const first = (paths) => paths.find(exists)

const copy = (source, target, options = {}) => {
  if (exists(target) && realpathSync(source) === realpathSync(target)) return
  cpSync(source, target, options)
}

const copyBundle = (source, target) => {
  if (exists(target) && realpathSync(source) === realpathSync(target)) return
  rmSync(target, { force: true, recursive: true })
  if (source.endsWith('.app')) {
    execFileSync('ditto', [source, target])
    return
  }
  cpSync(source, target, { recursive: true })
}

const sevenZip = first([
  '/usr/local/bin/7zz',
  '/opt/homebrew/bin/7zz',
  '/usr/bin/7z',
  'C:\\Program Files\\7-Zip\\7z.exe',
])

if (sevenZip) {
  copy(sevenZip, join(binDir, basename(sevenZip)))
  const dll = 'C:\\Program Files\\7-Zip\\7z.dll'
  if (exists(dll)) copy(dll, join(binDir, '7z.dll'))
}

const libreOffice = first([
  '/Applications/LibreOffice.app',
  'C:\\Program Files\\LibreOffice',
])

if (libreOffice) {
  copyBundle(
    libreOffice,
    join(loDir, libreOffice.endsWith('.app') ? 'LibreOffice.app' : 'LibreOffice')
  )
}
