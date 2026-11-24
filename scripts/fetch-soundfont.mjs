// node scripts/fetch-soundfont.mjs
// Downloads the instrument sound bank (about 23 MB) into public/soundfonts/ if it is
// not already there, so the project zip / repository can stay small. It runs
// automatically before `npm run dev`, `npm run build` and `npm run electron:dev`.
// The bank is FluidR3Mono_GM.sf3 — MuseScore's default "MS Basic" sounds (MIT licence,
// see public/soundfonts/FluidR3Mono_LICENSE.md).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'soundfonts')
const file = path.join(dir, 'FluidR3Mono_GM.sf3')
const URL_SF = 'https://raw.githubusercontent.com/musescore/MuseScore/main/share/sound/FluidR3Mono_GM.sf3'
const MIN_BYTES = 20_000_000

if (fs.existsSync(file) && fs.statSync(file).size > MIN_BYTES) process.exit(0)

console.log('Downloading the instrument sound bank (about 23 MB, one time)…')
try {
  const res = await fetch(URL_SF)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < MIN_BYTES || buf.subarray(0, 4).toString() !== 'RIFF') throw new Error('downloaded file is not a sound bank')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, buf)
  console.log(`Saved ${path.relative(process.cwd(), file)} (${(buf.length / 1e6).toFixed(1)} MB)`)
} catch (e) {
  // never block a build: the app falls back to its basic piano sound without the bank
  console.warn(`\nCould not download the sound bank (${e.message}).`)
  console.warn(`Download it manually from:\n  ${URL_SF}\nand save it as:\n  public/soundfonts/FluidR3Mono_GM.sf3\n`)
}