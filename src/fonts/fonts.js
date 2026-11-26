// src/fonts/fonts.js
// The single place that decides which fonts FaithScore uses.
//
//   Notation symbols (clefs, noteheads, accidentals…)  Leland   — what MuseScore 4 uses
//   Score text (title, lyrics, dynamics words, names)  Edwin    — MuseScore 4's text font
//        …with Gentium Plus behind it for the letters Edwin lacks (Yoruba/Igbo ẹ ọ ṣ ị ụ
//        and tone marks, IPA ɛ ɔ). Edwin alone would silently swap in a different,
//        computer-dependent font for those letters.
//   Interface (menus, buttons, panels)                  Inter
//
// All of them are bundled (public/fonts), so the app looks identical on Windows, Mac
// and Linux, offline, and in exported PDFs.
import { VexFlow } from 'vexflow'

export const FONT_SCORE = 'Edwin, "Gentium Plus", "Times New Roman", serif'
export const FONT_UI    = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const FONT_MONO  = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

// Characters used to make the browser load the right font files up front
// (it loads a font file only when a character in its unicode-range is needed).
const SAMPLE = 'AaBb0123 ẹọṣịụṅńǹɛɔ àáèéìíòóùú ♭♯'

let loading = null

// Loads every font before the first score is laid out. Layout measures text, so
// measuring before the real font arrives would give wrong bar widths. Never
// blocks longer than `timeoutMs` — the app starts with fallback fonts instead.
export function loadAppFonts({ timeoutMs = 4000 } = {}) {
  if (loading) return loading
  const faces = [
    ['16px Leland', 'ABC'],
    ['16px Edwin', SAMPLE], ['italic 16px Edwin', SAMPLE], ['bold 16px Edwin', SAMPLE],
    ['16px "Gentium Plus"', SAMPLE], ['italic 16px "Gentium Plus"', SAMPLE], ['bold 16px "Gentium Plus"', SAMPLE],
    ['16px "Inter Variable"', SAMPLE], ['bold 16px "Inter Variable"', SAMPLE],
  ]
  const work = Promise.all(faces.map(([f, t]) => document.fonts.load(f, t).catch(() => [])))
  const timeout = new Promise((r) => setTimeout(r, timeoutMs))
  loading = Promise.race([work, timeout]).then(() => {
    applyNotationFonts()
  })
  return loading
}

// VexFlow draws notation glyphs and its own text from one font stack: notation
// font first, then the text fonts for anything that isn't a music symbol.
export function applyNotationFonts() {
  try { VexFlow.setFonts('Leland', 'Edwin', 'Gentium Plus') } catch (_) {}
}