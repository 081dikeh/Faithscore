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
// printScore — opens a print-ready window using the live VexFlow SVG.
//
// WHY BLOB URL (not document.write):
//   document.write() fires the print script before the browser has finished
//   painting the SVG content — the print dialog opens on a blank page.
//   A blob URL is loaded as a full document; the browser paints everything
//   before any script runs, so fonts and paths are guaranteed to be visible.
//
// WHY EXPLICIT FILL INJECTION:
//   VexFlow 5 sets fill/stroke on its rendering context, but these values
//   are stored as JS state — not written as SVG attributes on each element.
//   When the SVG is cloned and embedded in a new document, paths that relied
//   on inherited context fill render as transparent. We walk every <path>,
//   <rect>, <circle>, and <polygon> in the clone and stamp fill="black"
//   stroke="black" on any element that has no explicit fill attribute set.
export function printScore(score) {
  const title    = score?.title    || 'Untitled Score'
  const composer = score?.composer || ''

  const pages = document.querySelectorAll('.score-page')
  if (!pages.length) { alert('Nothing to print yet — add some notes first.'); return }

  const svgElements = []
  pages.forEach(page => {
    page.querySelectorAll('svg').forEach(svg => svgElements.push(svg))
  })
  if (!svgElements.length) { alert('No score SVG found.'); return }

  // ── Collect @font-face CSS from the host document ─────────────────────────
  let fontCSS = ''
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule.type === CSSRule.FONT_FACE_RULE) fontCSS += rule.cssText + '\n'
        }
      } catch(_) {}
    }
  } catch(_) {}

  // ── Clone + fix each SVG ───────────────────────────────────────────────────
  const serializer = new XMLSerializer()

  function fixSvgForPrint(svg) {
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns',       'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

    // Preserve viewBox so the SVG knows its coordinate space
    const vb = svg.getAttribute('viewBox') || `0 0 ${svg.getAttribute('width') || 900} ${svg.getAttribute('height') || 600}`
    clone.setAttribute('viewBox', vb)
    clone.setAttribute('preserveAspectRatio', 'xMinYMin meet')
    clone.removeAttribute('width')
    clone.removeAttribute('height')
    clone.style.cssText = 'width:100%;height:auto;display:block;overflow:visible;'

    // ── Inject explicit fill/stroke on every shape element ──────────────────
    // VexFlow 5 SVG renderer writes fill/stroke to its JS context object but
    // does NOT always stamp them as XML attributes on each shape. When the SVG
    // is moved to a new document the context inheritance is lost → transparent.
    //
    // Strategy:
    //   • <path> with no fill attr  → fill="black" stroke="black"
    //   • <rect> (staff lines)      → keep as-is (they already have stroke)
    //   • <text>/<tspan>            → fill="black"
    //   • elements with fill="none" → leave alone (open shapes, slurs, etc.)
    //   • elements already colored  → leave alone (selected notes etc.)
    //
    // We also stamp a black fill on the root <g> as a safe default.
    const rootG = clone.querySelector('g')
    if (rootG && !rootG.getAttribute('fill')) {
      rootG.setAttribute('fill', 'black')
      rootG.setAttribute('stroke', 'black')
    }

    const SHAPE_TAGS = new Set(['path', 'circle', 'ellipse', 'polygon', 'polyline'])

    clone.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase()

      if (SHAPE_TAGS.has(tag)) {
        const fill   = el.getAttribute('fill')
        const stroke = el.getAttribute('stroke')

        // If no explicit fill → default to black (notehead, stem, beam)
        if (!fill || fill === '') el.setAttribute('fill', 'black')
        // If fill is 'none' on a path → this is an open-path glyph outline that
        // VexFlow draws with stroke only (e.g. half notehead) — set stroke black
        if (fill === 'none' && (!stroke || stroke === '')) el.setAttribute('stroke', 'black')
        if (!stroke && fill !== 'none') el.setAttribute('stroke', el.getAttribute('fill') || 'black')
      }

      if (tag === 'text' || tag === 'tspan') {
        if (!el.getAttribute('fill')) el.setAttribute('fill', 'black')
      }

      // Rect: staff lines use stroke only — ensure stroke is set
      if (tag === 'rect') {
        const fill = el.getAttribute('fill')
        if (!fill) el.setAttribute('fill', 'none')
        if (!el.getAttribute('stroke')) el.setAttribute('stroke', 'black')
      }

      // Remove any style properties that could override visibility
      const style = el.getAttribute('style')
      if (style) {
        // Strip color:transparent, opacity:0, visibility:hidden from inline styles
        const cleaned = style
          .replace(/color\s*:\s*transparent[^;]*/gi, 'color:black')
          .replace(/opacity\s*:\s*0[^.][^;]*/gi, '')
          .replace(/visibility\s*:\s*hidden[^;]*/gi, '')
          .replace(/display\s*:\s*none[^;]*/gi, '')
        el.setAttribute('style', cleaned)
      }
    })

    return serializer.serializeToString(clone)
  }

  const svgBlocks = svgElements
    .map(svg => `<div class="score-row">${fixSvgForPrint(svg)}</div>`)
    .join('\n')

  // ── Build the full print HTML ─────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    /* Music font — needed for text-based glyphs */
    ${fontCSS}

    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box }
    html, body { background:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

    @page { size:A4 portrait; margin:12mm 14mm; }

    /* Screen preview */
    @media screen {
      body { background:#9ca3af; padding:12mm 0; }
      .page {
        width:210mm; min-height:297mm; margin:0 auto;
        background:white; padding:12mm 14mm 14mm;
        box-shadow:0 4px 24px rgba(0,0,0,0.3);
      }
    }
    /* Print */
    @media print {
      body, .page { background:white; padding:0; margin:0; box-shadow:none; }
    }

    /* Score header */
    .header {
      text-align:center; margin-bottom:7mm; padding-bottom:4mm;
      border-bottom:0.8pt solid #555;
      font-family:'Times New Roman', Times, serif;
    }
    .header h1 { font-size:22pt; font-weight:bold; color:#111; margin-bottom:2mm; }
    .header .composer { font-size:11pt; color:#444; text-align:right; font-style:italic; }

    /* SVG rows */
    .score-row {
      width:100%; margin-bottom:5mm; overflow:visible;
      /* Force all SVG content visible — belt-and-suspenders */
      color: black;
    }
    .score-row svg {
      width:100% !important; height:auto !important;
      display:block; overflow:visible;
      /* Ensure paths/shapes inherit black from parent if fill not set */
      fill:black; stroke:black;
    }
    /* VexFlow uses <g> groups — ensure fill/stroke cascade */
    .score-row svg g { fill:inherit; stroke:inherit; }
    /* Staff lines and barlines are rect/path strokes — keep black */
    .score-row svg path,
    .score-row svg rect,
    .score-row svg circle,
    .score-row svg ellipse { fill:inherit; }
    /* Explicit overrides for known transparent/white fills from beam flag hiding */
    .score-row svg [fill="transparent"],
    .score-row svg [fill="rgba(0,0,0,0)"],
    .score-row svg [stroke="transparent"],
    .score-row svg [stroke="rgba(0,0,0,0)"] {
      fill:none !important; stroke:none !important;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${title}</h1>
      ${composer ? `<div class="composer">${composer}</div>` : ''}
    </div>
    ${svgBlocks}
  </div>
  <script>
    // Use requestAnimationFrame to ensure the browser has painted before print.
    // Two rAF cycles = guaranteed post-paint in all major browsers.
    function doPrint() {
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          // Also wait for fonts as a secondary guarantee
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function() {
              window.print()
            })
          } else {
            window.print()
          }
        })
      })
    }
    if (document.readyState === 'complete') {
      doPrint()
    } else {
      window.addEventListener('load', doPrint)
    }
  <\/script>
</body>
</html>`

  // ── Open as a Blob URL — guaranteed to load fully before scripts run ───────
  // document.write() fires scripts mid-stream; blob URLs load atomically.
  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, '_blank')

  if (!win) {
    // Popup blocked — trigger download instead
    const a = document.createElement('a')
    a.href = url; a.download = `${title.replace(/[^a-z0-9]/gi,'_')}.html`; a.click()
  }

  // Clean up the blob URL after a delay (win needs it to stay alive briefly)
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
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