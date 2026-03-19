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
// Serializes the score SVG(s) to self-contained HTML and opens a print dialog.
// Uses XMLSerializer so VexFlow glyphs render correctly in the print window.
export function printScore(score) {
  const title = score?.title || 'Untitled Score'
  const composer = score?.composer || ''

  // Find the VexFlow SVG(s) inside .score-page divs
  const pages = document.querySelectorAll('.score-page')
  if (!pages.length) {
    alert('Nothing to print yet. Add some notes first.')
    return
  }

  const serializer = new XMLSerializer()
  let pagesHTML = ''

  pages.forEach((page) => {
    // Get the SVG element inside this page
    const svg = page.querySelector('svg')
    const svgStr = svg ? serializer.serializeToString(svg) : ''

    // Get the header HTML (title, composer)
    const header = page.querySelector('[data-print-header]')
    const headerHTML = header ? header.outerHTML : ''

    pagesHTML += `
    <div class="score-page">
      ${headerHTML}
      <div class="score-svg">${svgStr}</div>
    </div>`
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: white; }
    body { font-family: 'Times New Roman', serif; }

    .score-page {
      width: 210mm;
      min-height: 297mm;
      padding: 15mm 13mm 10mm 13mm;
      background: white;
      page-break-after: always;
      overflow: hidden;
    }
    .score-page:last-child { page-break-after: avoid; }

    .score-title {
      text-align: center;
      font-size: 22pt;
      font-weight: bold;
      font-family: 'Times New Roman', serif;
      margin-bottom: 4mm;
    }
    .score-composer {
      text-align: right;
      font-size: 11pt;
      font-family: 'Times New Roman', serif;
      margin-bottom: 6mm;
      color: #444;
    }

    .score-svg svg {
      width: 184mm !important;  /* 210mm - 26mm margins */
      height: auto !important;
      display: block;
    }

    @media print {
      html, body { margin: 0; padding: 0; }
      .score-page { page-break-after: always; }
      .score-page:last-child { page-break-after: avoid; }
    }
    @page { size: A4 portrait; margin: 0; }
  </style>
</head>
<body>
  <div class="score-page">
    <div class="score-title" data-print-header>${title}</div>
    ${composer ? `<div class="score-composer" data-print-header>${composer}</div>` : ''}
    <div class="score-svg">
      ${pages[0]?.querySelector('svg') ? serializer.serializeToString(pages[0].querySelector('svg')) : ''}
    </div>
  </div>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 800)
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