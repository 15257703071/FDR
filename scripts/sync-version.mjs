import fs from 'node:fs'

const version = process.argv[2]?.replace(/^v/, '')
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: pnpm version:sync <x.y.z>')
}

const writeJson = (file, update) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  update(data)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

writeJson('package.json', (data) => {
  data.version = version
})

writeJson('src-tauri/tauri.conf.json', (data) => {
  data.version = version
})

const cargoFile = 'src-tauri/Cargo.toml'
const cargo = fs.readFileSync(cargoFile, 'utf8')
fs.writeFileSync(
  cargoFile,
  cargo.replace(/^version = ".+"$/m, `version = "${version}"`)
)
