// src/utils/exportScore.js
// ─────────────────────────────────────────────────────────────────────────────
// Export utilities: MusicXML, MIDI (via binary), Print/PDF
// ─────────────────────────────────────────────────────────────────────────────

import { DURATION_BEATS, noteDuration } from '../store/scoreStore'

// ── Helpers ───────────────────────────────────────────────────────────────────
function xml(tag, attrs, ...children) {
  const attrStr = Object.entries(attrs||{}).map(([k,v]) => ` ${k}="${v}"`).join('')
  const inner = children.flat().join('\n')
  return `<${tag}${attrStr}>${inner}</${tag}>`
}
function xmlLeaf(tag, val, attrs) {
  const attrStr = Object.entries(attrs||{}).map(([k,v]) => ` ${k}="${v}"`).join('')
  return `<${tag}${attrStr}>${val}</${tag}>`
}

const DUR_TO_XML = { w:'whole', h:'half', q:'quarter', '8':'eighth', '16':'16th', '32':'32nd' }
const DUR_TO_DIVS = { w:16, h:8, q:4, '8':2, '16':1, '32':0 }  // divisions=4 per quarter
const DIVISIONS = 4  // quarter note = 4 divisions

// ── MusicXML Export ────────────────────────────────────────────────────────────
export function exportMusicXML(score) {
  const parts = score.parts
  const numMeasures = Math.max(...parts.map(p => p.measures.length), 0)

  const partListItems = parts.map((p, i) =>
    xml('score-part', { id: `P${i+1}` },
      xmlLeaf('part-name', p.name)
    )
  )

  const partElements = parts.map((part, pi) => {
    const clef = part.clef || 'treble'
    const measures = []

    for (let mi = 0; mi < numMeasures; mi++) {
      const m   = part.measures[mi]
      if (!m) continue
      const ts  = m.timeSignature || { beats: 4, beatType: 4 }
      const ks  = m.keySignature ?? 0

      const attrs = mi === 0 ? xml('attributes', {},
        xmlLeaf('divisions', DIVISIONS),
        xml('key', {}, xmlLeaf('fifths', ks)),
        xml('time', {}, xmlLeaf('beats', ts.beats), xmlLeaf('beat-type', ts.beatType)),
        xml('clef', {},
          xmlLeaf('sign', clef === 'bass' ? 'F' : 'G'),
          xmlLeaf('line', clef === 'bass' ? '4' : '2')
        )
      ) : ''

      const noteElements = m.notes.filter(n => !n.chordWith).map(n => {
        const dur  = noteDuration(n)
        const divs = Math.round(dur * DIVISIONS)
        const type = DUR_TO_XML[n.duration] || 'quarter'

        if (n.isRest) {
          return xml('note', {},
            xml('rest', {}),
            xmlLeaf('duration', divs),
            xmlLeaf('type', type),
          )
        }

        const p   = n.pitch
        const acc = p.accidental === '#' ? 'sharp' : p.accidental === 'b' ? 'flat'
                  : p.accidental === '##' ? 'double-sharp' : p.accidental === 'bb' ? 'flat-flat' : ''

        return xml('note', {},
          xml('pitch', {},
            xmlLeaf('step', p.step),
            acc ? xmlLeaf('alter', acc === 'sharp' ? 1 : acc === 'flat' ? -1 : acc === 'double-sharp' ? 2 : -2) : '',
            xmlLeaf('octave', p.octave),
          ),
          xmlLeaf('duration', divs),
          xmlLeaf('type', type),
          acc ? xml('accidental', {}, acc) : '',
          n.dots ? xml('dot', {}) : '',
          n.tieStart ? xml('tie', { type: 'start' }) : '',
          n.lyric ? xml('lyric', { number: '1' }, xmlLeaf('text', n.lyric)) : '',
        )
      })

      measures.push(xml('measure', { number: mi + 1 }, attrs, ...noteElements))
    }

    return xml('part', { id: `P${pi+1}` }, ...measures)
  })

  const doc = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
${xml('score-partwise', { version: '3.1' },
  xml('work', {}, xmlLeaf('work-title', score.title || 'Untitled')),
  xmlLeaf('movement-title', score.title || 'Untitled'),
  xml('identification', {},
    xml('encoding', {}, xmlLeaf('software', 'ScoreAI'))
  ),
  xml('part-list', {}, ...partListItems),
  ...partElements
)}`

  download(doc, `${score.title || 'score'}.xml`, 'application/vnd.recordare.musicxml+xml')
}

// ── MIDI Export ────────────────────────────────────────────────────────────────
// Builds a minimal Type-0 MIDI file from scratch (no external library needed)
export function exportMIDI(score) {
  const tempo      = score.tempo || 120
  const uspb       = Math.round(60_000_000 / tempo)  // microseconds per beat
  const TPQ        = 480  // ticks per quarter note

  function varLen(n) {
    // Variable-length MIDI encoding
    const bytes = []
    bytes.push(n & 0x7F)
    n >>= 7
    while (n > 0) { bytes.unshift((n & 0x7F) | 0x80); n >>= 7 }
    return bytes
  }

  const NOTE_ON  = 0x90
  const NOTE_OFF = 0x80

  // Build events for all parts merged into one track (Type-0)
  const events = []

  // Tempo event at tick 0
  events.push({ tick: 0, data: [0xFF, 0x51, 0x03, (uspb>>16)&0xFF, (uspb>>8)&0xFF, uspb&0xFF] })

  const parts = score.parts
  const numM  = Math.max(...parts.map(p => p.measures.length), 0)

  let globalTick = 0
  for (let mi = 0; mi < numM; mi++) {
    const beats = parts[0]?.measures[mi]?.timeSignature?.beats ?? 4

    for (const part of parts) {
      const m = part.measures[mi]
      if (!m) continue

      const ch = parts.indexOf(part)  // channel per part
      let beatCursor = 0

      for (const note of m.notes.filter(n => !n.chordWith)) {
        const durBeats = noteDuration(note)
        const durTicks = Math.round(durBeats * TPQ)

        if (!note.isRest && note.pitch) {
          const midi = pitchToMidi(note.pitch)
          const tick = globalTick + Math.round(beatCursor * TPQ)
          events.push({ tick, data: [NOTE_ON | ch, midi, 80] })
          events.push({ tick: tick + durTicks - 10, data: [NOTE_OFF | ch, midi, 0] })
        }
        beatCursor += durBeats
      }
    }

    globalTick += Math.round(beats * TPQ)
  }

  // End of track
  events.push({ tick: globalTick, data: [0xFF, 0x2F, 0x00] })
  events.sort((a, b) => a.tick - b.tick)

  // Convert to delta-time events
  let prevTick = 0
  const trackBytes = []
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - prevTick)
    prevTick = ev.tick
    trackBytes.push(...varLen(delta), ...ev.data)
  }

  // Build MIDI file bytes
  const header = [
    0x4D,0x54,0x68,0x64,  // MThd
    0,0,0,6,              // length = 6
    0,0,                  // format = 0 (single track)
    0,1,                  // num tracks = 1
    (TPQ>>8)&0xFF, TPQ&0xFF  // ticks per quarter
  ]

  const trackLen = trackBytes.length
  const track = [
    0x4D,0x54,0x72,0x6B,  // MTrk
    (trackLen>>24)&0xFF, (trackLen>>16)&0xFF, (trackLen>>8)&0xFF, trackLen&0xFF,
    ...trackBytes
  ]

  const bytes = new Uint8Array([...header, ...track])
  downloadBytes(bytes, `${score.title || 'score'}.mid`, 'audio/midi')
}

function pitchToMidi(pitch) {
  const base = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }
  let semi = base[pitch.step] + (pitch.octave + 1) * 12
  if (pitch.accidental === '#') semi++
  if (pitch.accidental === 'b') semi--
  if (pitch.accidental === '##') semi+=2
  if (pitch.accidental === 'bb') semi-=2
  return Math.max(0, Math.min(127, semi))
}

// ── Print / PDF ────────────────────────────────────────────────────────────────
// printScore — embeds font-face rules into SVG so it renders correctly in print.
// The Bravura music font is loaded via @font-face in the app CSS. When we open
// a new print window, that font is not available there. We solve this by:
// 1. Extracting all @font-face rules from the current document's stylesheets
// 2. Injecting them as an inline <style> inside each SVG clone
// 3. Using a data: URI (not blob URL) to avoid cross-origin canvas tainting
// 4. Drawing each SVG onto a canvas at 2× resolution, then printing the PNGs
export async function printScore(score) {
  const title    = score?.title    || 'Untitled Score'
  const composer = score?.composer || ''

  const pages = document.querySelectorAll('.score-page')
  if (!pages.length) { alert('Nothing to print yet. Add some notes first.'); return }

  const svgElements = []
  pages.forEach(page => {
    page.querySelectorAll('svg').forEach(svg => svgElements.push(svg))
  })
  if (!svgElements.length) { alert('No score content found to print.'); return }

  // ── Step 1: Collect all @font-face rules from document stylesheets ──────────
  let fontFaceCSS = ''
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            fontFaceCSS += rule.cssText + '\n'
          }
        }
      } catch(_) {}   // cross-origin sheets will throw — skip them
    }
  } catch(_) {}

  // ── Step 2: Also inline the actual font as base64 if possible ──────────────
  // VexFlow's Bravura glyphs use Unicode codepoints. The glyphs must be present.
  // We try to convert the font URL to base64 so the SVG is fully self-contained.
  let bravuraBase64 = ''
  try {
    // Find the Bravura font URL from the @font-face rules
    const urlMatch = fontFaceCSS.match(/url\(["']?([^"')]+\.woff2?)["']?\)/)
    if (urlMatch) {
      const fontUrl = urlMatch[1]
      const resp = await fetch(fontUrl)
      if (resp.ok) {
        const buf  = await resp.arrayBuffer()
        const b64  = btoa(String.fromCharCode(...new Uint8Array(buf)))
        const mime = fontUrl.includes('woff2') ? 'font/woff2' : 'font/woff'
        // Replace the URL in fontFaceCSS with the base64 version
        fontFaceCSS = fontFaceCSS.replace(
          /url\(["']?[^"')]+\.woff2?["']?\)/g,
          `url('data:${mime};base64,${b64}')`
        )
        bravuraBase64 = b64
      }
    }
  } catch(_) {}

  const serializer = new XMLSerializer()

  // ── Step 3: Rasterize each SVG → canvas → PNG ──────────────────────────────
  const pngDataUrls = await Promise.all(svgElements.map(svg => {
    return new Promise(resolve => {
      try {
        const svgRect = svg.getBoundingClientRect()
        const W = Math.max(svgRect.width  || svg.width?.baseVal?.value  || 800, 50)
        const H = Math.max(svgRect.height || svg.height?.baseVal?.value || 200, 50)

        // Clone the SVG and inject font-face styles into <defs>
        const clone = svg.cloneNode(true)
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

        // Inject font CSS into the SVG so glyphs render in the canvas context
        if (fontFaceCSS) {
          let defs = clone.querySelector('defs')
          if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); clone.prepend(defs) }
          const style = document.createElementNS('http://www.w3.org/2000/svg','style')
          style.textContent = fontFaceCSS
          defs.prepend(style)
        }

        const svgString = serializer.serializeToString(clone)
        // Use data URI instead of blob URL — avoids cross-origin canvas tainting
        const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
        const img = new Image()

        img.onload = () => {
          const scale  = 2   // 2× for sharp print quality
          const canvas = document.createElement('canvas')
          canvas.width  = W * scale
          canvas.height = H * scale
          const ctx2 = canvas.getContext('2d')
          ctx2.scale(scale, scale)
          ctx2.fillStyle = 'white'
          ctx2.fillRect(0, 0, W, H)
          ctx2.drawImage(img, 0, 0, W, H)
          try {
            resolve(canvas.toDataURL('image/png', 1.0))
          } catch(e) {
            // Canvas still tainted (font couldn't be inlined) — use SVG directly
            resolve('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString))
          }
        }
        img.onerror = () => resolve(null)
        img.src = dataUri
      } catch(e) { resolve(null) }
    })
  }))

  const validUrls = pngDataUrls.filter(Boolean)
  if (!validUrls.length) { alert('Could not export the score. Try MusicXML export.'); return }

  const imgTags = validUrls.map(dataUrl =>
    `<div class="score-img"><img src="${dataUrl}" alt="score" /></div>`
  ).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: white; }
    .print-page {
      width: 210mm;
      padding: 14mm 12mm 10mm 12mm;
      background: white;
    }
    .score-header {
      text-align: center;
      margin-bottom: 6mm;
      border-bottom: 0.5pt solid #ccc;
      padding-bottom: 4mm;
    }
    .score-header h1 {
      font-size: 20pt;
      font-weight: bold;
      font-family: 'Times New Roman', serif;
    }
    .score-header p {
      font-size: 11pt;
      text-align: right;
      color: #444;
      margin-top: 2mm;
      font-family: 'Times New Roman', serif;
    }
    .score-img { margin-bottom: 4mm; }
    .score-img img {
      width: 100%;
      height: auto;
      display: block;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    @media screen {
      body { background: #ccc; padding: 10mm; }
      .print-page { box-shadow: 0 2px 12px rgba(0,0,0,0.25); margin: 0 auto; }
    }
    @media print {
      html, body { background: white; padding: 0; margin: 0; }
      .print-page { padding: 14mm 12mm; }
      .score-img { break-inside: avoid; }
    }
    @page { size: A4 portrait; margin: 0; }
  </style>
</head>
<body>
  <div class="print-page">
    <div class="score-header">
      <h1>${title}</h1>
      ${composer ? `<p>${composer}</p>` : ''}
    </div>
    ${imgTags}
  </div>
  <script>
    // Wait for all images to load before printing
    window.addEventListener('load', function() {
      const imgs = document.querySelectorAll('img')
      let loaded = 0
      const tryPrint = () => { if (++loaded >= imgs.length) { setTimeout(() => { window.print() }, 400) } }
      if (imgs.length === 0) { setTimeout(() => { window.print() }, 400) }
      imgs.forEach(img => {
        if (img.complete) tryPrint()
        else { img.onload = tryPrint; img.onerror = tryPrint }
      })
    })
  <\/script>
</body>
</html>`

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    // Popup blocked — fallback: create a blob URL
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.html`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}

// ── Download helpers ──────────────────────────────────────────────────────────
function download(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadBytes(bytes, filename, mimeType) {
  const blob = new Blob([bytes], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

