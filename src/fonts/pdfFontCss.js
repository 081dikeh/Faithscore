// src/fonts/pdfFontCss.js
// PDF pages are made by rasterising a detached copy of the score SVG. That copy can't see the
// page's fonts, so the fonts it needs are embedded INSIDE it as @font-face rules with the font
// bytes as data URIs. Only what a page needs is embedded: Leland (notation) and Edwin (text)
// always; Gentium Plus only when the text has characters Edwin lacks (Yoruba/Igbo ẹ ọ ṣ ị ụ,
// tone marks, IPA ɛ ɔ), and its bold/italic only if the page uses them.
import fontsCss from './fonts.css?raw'

const dataCache = new Map()     // url -> base64
const styleCache = new Map()    // variant key -> <style> string

async function toBase64(url) {
  if (dataCache.has(url)) return dataCache.get(url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`font ${url}: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const b64 = btoa(bin)
  dataCache.set(url, b64)
  return b64
}

const EDWIN_MISSING = /[\u0250-\u02af\u0300-\u036f\u1e00-\u1eff]/

// svgElement: the page <svg> about to be rasterised
export async function getPdfFontStyle(svgElement) {
  const text = svgElement.textContent || ''
  const markup = svgElement.outerHTML || ''
  const needGentium = EDWIN_MISSING.test(text)
  const needItalic = /italic/.test(markup)
  const needBold = /bold|font-weight[=:]\s*["']?[6-9]00/.test(markup)
  const key = `${needGentium}|${needItalic}|${needBold}`
  if (styleCache.has(key)) return styleCache.get(key)

  const base = (import.meta.env && import.meta.env.BASE_URL) || '/'
  const blocks = fontsCss.split('@font-face').slice(1).map((b) => '@font-face' + b.split('}')[0] + '}')
  const out = []
  for (const block of blocks) {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1]
    const style = /font-style:\s*(\w+)/.exec(block)?.[1]
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] || 400)
    if (family === 'Inter Variable') continue
    if (family === 'Gentium Plus') {
      if (!needGentium) continue
      if (style === 'italic' && !needItalic) continue
      if (weight >= 700 && !needBold) continue
    }
    const m = /url\('\/fonts\/([^']+)'\)/.exec(block)
    if (!m) continue
    const b64 = await toBase64(`${base}fonts/${m[1]}`)
    const mime = m[1].endsWith('.otf') ? 'font/otf' : 'font/woff2'
    out.push(block.replace(m[0], `url(data:${mime};base64,${b64})`))
  }
  const css = `<style>${out.join('\n')}</style>`
  styleCache.set(key, css)
  return css
}