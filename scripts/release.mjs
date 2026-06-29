import { spawnSync } from 'node:child_process'

const rawVersion = process.argv[2]
const noPush = process.argv.includes('--no-push')
const version = rawVersion?.replace(/^v/, '')

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: pnpm release <x.y.z> [--no-push]')
}

const tag = `v${version}`

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout)
  }
  return result.stdout.trim()
}

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (output('git', ['rev-parse', '--is-inside-work-tree']) !== 'true') {
  throw new Error('Not inside a git repository')
}

if (output('git', ['tag', '--list', tag])) {
  throw new Error(`${tag} already exists`)
}

run('node', ['scripts/sync-version.mjs', version])
run('pnpm', ['run', 'build'])
run('git', ['add', '.'])

const diff = spawnSync('git', ['diff', '--cached', '--quiet'])
if (diff.status === 0) {
  throw new Error('No staged changes to release')
}

run('git', ['commit', '-m', `chore: release ${tag}`])
run('git', ['tag', tag])

if (!noPush) {
  const branch = output('git', ['branch', '--show-current']) || 'main'
  run('git', ['push', 'origin', branch])
  run('git', ['push', 'origin', tag])
}
