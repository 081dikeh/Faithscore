// src/utils/exportSolfa.js
// ─────────────────────────────────────────────────────────────────────────────
// FaithScore — Solfa Export Utilities
//
//  exportSolfaPDF(score, svgEl)   — opens a print window (PDF via browser print)
//  exportSolfaAudio(score, opts)  — renders audio offline → WAV download
//
// Audio rendering uses an OfflineAudioContext so it runs faster-than-realtime
// with no user-facing playback. The sampler samples are fetched from the same
// FluidR3 CDN used by useSolfaPlayback.
// ─────────────────────────────────────────────────────────────────────────────

import { solfaToMidi, migrateMeasure, resolveKeyAt } from '../store/solfaStore'

// ── Helpers ──────────────────────────────────────────────────────────────────

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function midiToNoteName(midi) {
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const c = Math.max(21, Math.min(108, midi))
  return `${NAMES[c % 12]}${Math.floor(c / 12) - 1}`
}

function voiceType(partLabel) {
  const l = (partLabel || '').toLowerCase()
  if (l.startsWith('s') || l === 'v') return 'soprano'
  if (l.startsWith('a'))              return 'alto'
  if (l.startsWith('t'))              return 'tenor'
  if (l.startsWith('b'))              return 'bass'
  return 'default'
}

const STEREO_PAN = { soprano: -0.3, alto: -0.6, tenor: 0.5, bass: 0.7, default: 0 }

const SF_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'

const SAMPLE_NOTES = {
  soprano: ['C4','E4','G4','C5','E5','G5','C6'],
  alto:    ['G3','C4','E4','G4','C5','E5'],
  tenor:   ['C3','E3','G3','C4','E4','G4','C5'],
  bass:    ['C2','E2','G2','C3','E3','G3','C4'],
  default: ['C3','E3','G3','C4','E4','G4','C5'],
}

// Parse a note name like "C#4" → { midi }
function noteNameToMidi(name) {
  const STEPS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
  const m = name.match(/^([A-G])(#|b)?(-?\d+)$/)
  if (!m) return 60
  const step = STEPS[m[1]]
  const acc  = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  const oct  = parseInt(m[3])
  return (oct + 1) * 12 + step + acc
}

// Fetch and decode a single MP3 sample
async function fetchSample(url, ctx) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  const ab  = await res.arrayBuffer()
  return ctx.decodeAudioData(ab)
}

// Build a simple pitch-shifting sampler for one voice type in an OfflineAudioContext
async function buildOfflineSampler(vtype, ctx, onProgress) {
  const notes   = SAMPLE_NOTES[vtype] || SAMPLE_NOTES.default
  const program = 'choir_aahs'
  const buffers = {}

  let loaded = 0
  await Promise.all(notes.map(async (note) => {
    const encoded = note.replace('#', 's')
    const url     = `${SF_BASE}/${program}-mp3/${encoded}.mp3`
    try {
      buffers[note] = await fetchSample(url, ctx)
    } catch (_) {
      // skip failed samples — neighbouring pitches will be used
    }
    loaded++
    onProgress?.(loaded / notes.length)
  }))

  // Find closest loaded sample for a target MIDI number
  function closestSample(targetMidi) {
    let best = null, bestDist = Infinity
    for (const [note, buf] of Object.entries(buffers)) {
      const dist = Math.abs(noteNameToMidi(note) - targetMidi)
      if (dist < bestDist) { bestDist = dist; best = { note, buf } }
    }
    return best
  }

  // Schedule a note in the OfflineAudioContext
  function scheduleNote(targetMidi, startSec, durSec, panPos, gainDb) {
    const sample = closestSample(targetMidi)
    if (!sample) return

    const sampleMidi  = noteNameToMidi(sample.note)
    const semitones   = targetMidi - sampleMidi
    const playbackRate = Math.pow(2, semitones / 12)

    const src = ctx.createBufferSource()
    src.buffer       = sample.buf
    src.playbackRate.value = playbackRate

    const gainNode = ctx.createGain()
    gainNode.gain.value = Math.pow(10, (gainDb ?? 0) / 20) * 0.75

    // Envelope: fast attack, sustain, gentle release
    gainNode.gain.setValueAtTime(0, startSec)
    gainNode.gain.linearRampToValueAtTime(gainNode.gain.value, startSec + 0.06)
    gainNode.gain.setValueAtTime(gainNode.gain.value, startSec + durSec - 0.08)
    gainNode.gain.linearRampToValueAtTime(0, startSec + durSec)

    const panner = ctx.createStereoPanner()
    panner.pan.value = panPos

    src.connect(gainNode)
    gainNode.connect(panner)
    panner.connect(ctx.destination)

    src.start(startSec)
    src.stop(startSec + durSec + 0.1)
  }

  return { scheduleNote }
}

// ── Build flat event list from score ────────────────────────────────────────
function buildEventList(score, tempo) {
  const bpm        = Math.max(20, Math.min(300, tempo || score.tempo || 80))
  const secPerBeat = 60 / bpm
  const secPerQUnit = secPerBeat / 4
  const events     = []
  let globalSec    = 0

  const parts = score.parts || []
  const numM  = Math.max(...parts.map(p => p.measures.length), 0)

  for (let mIdx = 0; mIdx < numM; mIdx++) {
    const refM     = migrateMeasure(parts[0]?.measures[mIdx])
    const numBeats = refM?.timeSignature?.beats || 4

    for (const part of parts) {
      const measure = migrateMeasure(part.measures[mIdx])
      if (!measure?.beats) continue

      const vtype  = voiceType(part.label)

      const flat = []
      let qAbs = 0
      measure.beats.forEach((beat, beatIdx) => {
        ;(beat.events || []).forEach((ev, eventIdx) => {
          flat.push({ ...ev, qAbs, beatIdx, eventIdx })
          qAbs += ev.duration
        })
      })

      let i = 0
      while (i < flat.length) {
        const ev = flat[i]
        if (ev.type === 'note' && ev.syllable) {
          let totalQ = ev.duration
          let j = i + 1
          while (j < flat.length && flat[j].type === 'sustain') {
            totalQ += flat[j].duration
            j++
          }
          const startSec = globalSec + ev.qAbs * secPerQUnit
          const durSec   = Math.max(0.08, totalQ * secPerQUnit - 0.025)
          const midi     = solfaToMidi(ev.syllable, ev.octave || 0, resolveKeyAt(score, mIdx, ev.beatIdx, ev.eventIdx))
          const panPos   = STEREO_PAN[vtype] ?? 0
          events.push({ startSec, durSec, midi, vtype, panPos, partLabel: part.label })
          i = j
        } else {
          i++
        }
      }
    }

    globalSec += numBeats * secPerBeat
  }

  return { events, totalSecs: globalSec }
}

// ── WAV encoder ─────────────────────────────────────────────────────────────
function audioBufferToWav(buffer) {
  const numCh     = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const samples   = buffer.length
  const bytesPerSample = 2  // 16-bit PCM
  const dataSize  = samples * numCh * bytesPerSample
  const ab        = new ArrayBuffer(44 + dataSize)
  const view      = new DataView(ab)

  function str(offset, s) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  function u16(offset, v) { view.setUint16(offset, v, true) }
  function u32(offset, v) { view.setUint32(offset, v, true) }

  str(0, 'RIFF'); u32(4, 36 + dataSize)
  str(8, 'WAVE')
  str(12, 'fmt '); u32(16, 16); u16(20, 1)
  u16(22, numCh); u32(24, sampleRate); u32(28, sampleRate * numCh * bytesPerSample)
  u16(32, numCh * bytesPerSample); u16(34, 16)
  str(36, 'data'); u32(40, dataSize)

  let offset = 44
  // Interleave channels
  for (let s = 0; s < samples; s++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[s]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }

  return ab
}

// ── Public: Export PDF / Print ──────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// A4 page geometry (mm) — matches the tightened values used for the staff
// side's print (see exportScore.js) so both apps produce similarly dense pages.
const SF_PAGE_W_MM    = 210
const SF_PAGE_H_MM    = 297
const SF_MARGIN_TOP   = 8
const SF_MARGIN_BOT   = 8
const SF_MARGIN_SIDE  = 14
const SF_USABLE_W_MM  = SF_PAGE_W_MM - SF_MARGIN_SIDE * 2
const SF_USABLE_H_MM  = SF_PAGE_H_MM - SF_MARGIN_TOP - SF_MARGIN_BOT
const SF_HEADER_H_MM_EST = 15 // title + meta row is a bit taller than the staff header

// SolfaRenderer tags each system's starting measure-number label with
// data-sysmark="1" data-sysy="<system top Y>" specifically so print export
// can find real system boundaries (see SolfaRenderer's `mnum-` text element).
function findSolfaSystemTops(svg) {
  const marks = Array.from(svg.querySelectorAll('[data-sysmark]'))
    .map(el => parseFloat(el.getAttribute('data-sysy')))
    .filter(y => !isNaN(y))
    .sort((a, b) => a - b)
  return marks.length >= 2 ? marks : null
}

// Groups system top-positions into page-sized chunks (SVG coordinate units).
function paginateSolfaSystems(sysTops, totalH, usableFirstUnits, usableRestUnits) {
  const n = sysTops.length
  const bottoms = sysTops.slice(1).concat([totalH])
  const slices = []
  let pageStart = 0
  let usable = usableFirstUnits
  for (let i = 0; i < n; i++) {
    const heightIfIncluded = bottoms[i] - sysTops[pageStart]
    if (heightIfIncluded > usable && i > pageStart) {
      slices.push({ y: sysTops[pageStart], height: bottoms[i - 1] - sysTops[pageStart] })
      pageStart = i
      usable = usableRestUnits
    }
  }
  slices.push({ y: sysTops[pageStart], height: bottoms[n - 1] - sysTops[pageStart] })

  // The very first page's crop should start at y=0, not at the first
  // system's y. SolfaRenderer draws the real "Doh is X" / time-signature
  // caption just above the first system (see HDR_H in SolfaRenderer) — that
  // text is genuinely part of the SVG, already correctly styled and
  // positioned. Starting the crop exactly at the first system's top was
  // silently slicing that caption out of every export, which is why a
  // separate, differently-worded, differently-styled caption had to be
  // synthesized to compensate instead of just including the real one.
  if (slices.length > 0) {
    const firstBottom = slices[0].y + slices[0].height
    slices[0] = { y: 0, height: firstBottom }
  }

  return slices
}

function cropSolfaSvg(svg, totalW, y, height) {
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.setAttribute('viewBox', `0 ${y} ${totalW} ${height}`)
  clone.style.width  = '100%'
  clone.style.height = 'auto'
  clone.style.display = 'block'
  return clone
}

export function exportSolfaPDF(score, svgElement) {
  const title = score?.title || 'Untitled'

  if (!svgElement) {
    alert('Nothing to print yet — add some notes first.')
    return
  }

  // Clean up any leftovers from a previous print (e.g. if afterprint never fired)
  document.getElementById('faithscore-solfa-print-root')?.remove()
  document.getElementById('faithscore-solfa-print-style')?.remove()

  const partsInfo = (score.parts || [])
    .map(p => `<span style="margin-right:14px"><strong>${escapeHtml(p.label)}</strong></span>`)
    .join('')

  // ── Build the print-only DOM ─────────────────────────────────────────────
  const root = document.createElement('div')
  root.id = 'faithscore-solfa-print-root'

  const pageEl = document.createElement('div')
  pageEl.className = 'sf-print-page'

  const header = document.createElement('div')
  header.className = 'sf-print-header'
  header.innerHTML = `
    <h1>${escapeHtml(title)}</h1>
    <div class="sf-print-meta">
      <span>${partsInfo}</span>
      <span>${score?.composer ? escapeHtml(score.composer) : ''}</span>
    </div>`
  pageEl.appendChild(header)

  const vb = svgElement.viewBox && svgElement.viewBox.baseVal
  const totalW = (vb && vb.width)  || svgElement.width.baseVal.value  || svgElement.getBoundingClientRect().width
  const totalH = (vb && vb.height) || svgElement.height.baseVal.value || svgElement.getBoundingClientRect().height

  const scaleUnitsPerMm  = totalW / SF_USABLE_W_MM
  const usableFirstUnits = (SF_USABLE_H_MM - SF_HEADER_H_MM_EST) * scaleUnitsPerMm
  const usableRestUnits  = SF_USABLE_H_MM * scaleUnitsPerMm

  const sysTops = findSolfaSystemTops(svgElement)
  const slices = sysTops
    ? paginateSolfaSystems(sysTops, totalH, Math.max(usableFirstUnits, 1), Math.max(usableRestUnits, 1))
    : [{ y: 0, height: totalH }] // couldn't detect systems — fall back to one uncut block

  slices.forEach((slice, i) => {
    const clone = cropSolfaSvg(svgElement, totalW, slice.y, slice.height)
    const row = document.createElement('div')
    row.className = 'sf-print-row'
    row.appendChild(clone)
    if (i < slices.length - 1) {
      row.style.breakAfter = 'page'
      row.style.pageBreakAfter = 'always'
    }
    row.style.breakInside = 'avoid'
    row.style.pageBreakInside = 'avoid'
    pageEl.appendChild(row)
  })

  root.appendChild(pageEl)
  document.body.appendChild(root)

  // ── Print-only styling ───────────────────────────────────────────────────
  const style = document.createElement('style')
  style.id = 'faithscore-solfa-print-style'
  style.textContent = `
    #faithscore-solfa-print-root { display: none; }
    .sf-print-header {
      text-align: center; margin-bottom: 3mm; padding-bottom: 1.5mm;
      border-bottom: 0.6pt solid #ccc; font-family: 'Times New Roman', Times, serif;
    }
    .sf-print-header h1 { font-size: 16pt; font-weight: bold; letter-spacing: -0.01em; margin: 0; }
    .sf-print-header .sf-print-meta {
      font-size: 9pt; color: #555; margin-top: 1.5mm;
      display: flex; justify-content: space-between;
    }
    .sf-print-row { width: 100%; }
    .sf-print-row svg { width: 100% !important; height: auto !important; display: block; overflow: visible; }
    @media print {
      body > *:not(#faithscore-solfa-print-root) { display: none !important; }
      #faithscore-solfa-print-root { display: block !important; }
      @page { size: ${SF_PAGE_W_MM}mm ${SF_PAGE_H_MM}mm; margin: ${SF_MARGIN_TOP}mm ${SF_MARGIN_SIDE}mm ${SF_MARGIN_BOT}mm ${SF_MARGIN_SIDE}mm; }
    }
  `
  document.head.appendChild(style)

  // Blank the page-title portion of the browser's print header for the
  // duration of the job (the date/URL/page-number portions are controlled
  // by the browser's own "Headers and footers" print setting and can't be
  // touched from the page).
  const prevTitle = document.title
  document.title = ''

  const cleanup = () => {
    document.getElementById('faithscore-solfa-print-root')?.remove()
    document.getElementById('faithscore-solfa-print-style')?.remove()
    document.title = prevTitle
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)

  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.print()
    setTimeout(cleanup, 8000)
  }))
}

// ── Publish: PDF Blob (no print dialog) ─────────────────────────────────────
// Same slicing math as exportSolfaPDF() above, but produces an in-memory PDF
// Blob instead of a browser print job.
export async function exportSolfaPdfBlob(score, svgElement) {
  const title = score?.title || 'Untitled'

  if (!svgElement) throw new Error('Nothing to publish yet — add some notes first.')

  const vb = svgElement.viewBox && svgElement.viewBox.baseVal
  const totalW = (vb && vb.width)  || svgElement.width.baseVal.value  || svgElement.getBoundingClientRect().width
  const totalH = (vb && vb.height) || svgElement.height.baseVal.value || svgElement.getBoundingClientRect().height

  const scaleUnitsPerMm  = totalW / SF_USABLE_W_MM
  const usableFirstUnits = (SF_USABLE_H_MM - SF_HEADER_H_MM_EST) * scaleUnitsPerMm
  const usableRestUnits  = SF_USABLE_H_MM * scaleUnitsPerMm

  const sysTops = findSolfaSystemTops(svgElement)
  const slices = sysTops
    ? paginateSolfaSystems(sysTops, totalH, Math.max(usableFirstUnits, 1), Math.max(usableRestUnits, 1))
    : [{ y: 0, height: totalH }]

  const pages = slices.map(slice => ({
    svgElement: cropSolfaSvg(svgElement, totalW, slice.y, slice.height),
    totalW,
    sliceHeight: slice.height,
  }))

  // The real "Doh is X" / time-signature caption is already part of the
  // cropped SVG content now (see paginateSolfaSystems), so the subtitle
  // slot here is free to carry what it actually means everywhere else in
  // the app: the composer's name — matching exactly how the staff/Score
  // app's export uses this same slot.
  const { buildPdfFromSvgPages } = await import('./pdfExport')
  return buildPdfFromSvgPages({
    pages,
    pageWmm: SF_PAGE_W_MM, pageHmm: SF_PAGE_H_MM, marginTop: SF_MARGIN_TOP, marginSide: SF_MARGIN_SIDE,
    title, subtitle: score?.composer || '',
    headerHeightMm: SF_HEADER_H_MM_EST,
  })
}

// ── Public: Export Audio (WAV) ───────────────────────────────────────────────
// opts: { tempo, onProgress(0-1), onStatus(str) }
export async function exportSolfaAudio(score, opts = {}) {
  const { onProgress, onStatus } = opts
  const tempo    = opts.tempo || score.tempo || 80
  const title    = score.title || 'Untitled'

  onStatus?.('Building score…')
  const { events, totalSecs } = buildEventList(score, tempo)

  if (events.length === 0) {
    onStatus?.('No notes to export.')
    return
  }

  // Add 1.5s of tail for reverb decay
  const renderDur = totalSecs + 1.5
  const SR        = 44100

  onStatus?.('Creating audio context…')
  const ctx = new OfflineAudioContext(2, Math.ceil(renderDur * SR), SR)

  // Reverb: simple convolution using a generated IR
  const reverbNode  = ctx.createConvolver()
  const reverbGain  = ctx.createGain(); reverbGain.gain.value = 0.32
  const dryGain     = ctx.createGain(); dryGain.gain.value = 0.68
  const masterGain  = ctx.createGain(); masterGain.gain.value = 0.85

  // Generate a simple exponential-decay reverb impulse response (~2s)
  const irLen = Math.floor(SR * 2.2)
  const irBuf = ctx.createBuffer(2, irLen, SR)
  for (let ch = 0; ch < 2; ch++) {
    const data = irBuf.getChannelData(ch)
    for (let i = 0; i < irLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5)
    }
  }
  reverbNode.buffer = irBuf

  // Signal chain: source → dryGain + reverbNode→reverbGain → masterGain → dest
  dryGain.connect(masterGain)
  reverbGain.connect(masterGain)
  masterGain.connect(ctx.destination)

  // Build samplers per unique voice type
  onStatus?.('Loading samples… (this may take a few seconds)')
  const vtypes  = [...new Set(events.map(e => e.vtype))]
  const samplers = {}
  let totalSamples = vtypes.length
  let loadedSamplers = 0

  await Promise.all(vtypes.map(async (vtype) => {
    samplers[vtype] = await buildOfflineSampler(vtype, ctx, (p) => {
      onProgress?.((loadedSamplers + p) / totalSamples * 0.6)
    })
    loadedSamplers++
    onProgress?.(loadedSamplers / totalSamples * 0.6)
  }))

  // Schedule all notes
  onStatus?.('Scheduling notes…')
  for (const ev of events) {
    const sampler = samplers[ev.vtype]
    if (!sampler) continue
    sampler.scheduleNote(ev.midi, ev.startSec, ev.durSec, ev.panPos, 0)
  }

  // Render offline
  onStatus?.('Rendering audio…')
  onProgress?.(0.65)

  // Poll progress during render
  let pollInterval = null
  let fakeProgress = 0.65
  pollInterval = setInterval(() => {
    fakeProgress = Math.min(0.92, fakeProgress + 0.01)
    onProgress?.(fakeProgress)
  }, 200)

  const rendered = await ctx.startRendering()
  clearInterval(pollInterval)
  onProgress?.(0.95)

  // Encode to WAV
  onStatus?.('Encoding WAV…')
  const wavAb = audioBufferToWav(rendered)
  onProgress?.(1.0)

  // Download
  const safeTitle = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'score'
  const blob = new Blob([wavAb], { type: 'audio/wav' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `${safeTitle}.wav`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)

  onStatus?.('Done! ✓')
}