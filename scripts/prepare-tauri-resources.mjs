import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const sameFile = (source, target) =>
  exists(source) &&
  exists(target) &&
  realpathSync(source) === realpathSync(target)

const copyFile = (source, target, mode) => {
  if (sameFile(source, target)) return
  rmSync(target, { force: true, recursive: true })
  copyFileSync(realpathSync(source), target)
  if (mode) chmodSync(target, mode)
}

const copyBundle = (source, target) => {
  if (sameFile(source, target)) return
  rmSync(target, { force: true, recursive: true })
  if (source.endsWith('.app')) {
    execFileSync('ditto', [source, target])
    return
  }
  cpSync(source, target, { recursive: true, force: true })
}

const sevenZip = first([
  '/usr/local/bin/7zz',
  '/opt/homebrew/bin/7zz',
  '/usr/bin/7zz',
  '/usr/bin/7z',
  'C:\\Program Files\\7-Zip\\7zz.exe',
  'C:\\Program Files\\7-Zip\\7z.exe',
])

if (sevenZip) {
  copyFile(sevenZip, join(binDir, basename(sevenZip)), 0o755)
  const dll = 'C:\\Program Files\\7-Zip\\7z.dll'
  if (exists(dll)) copyFile(dll, join(binDir, '7z.dll'))
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
