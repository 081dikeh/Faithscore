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

import { solfaToMidi, migrateMeasure } from '../store/solfaStore'

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
  const key        = score.key || 'C'
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
      for (const beat of measure.beats) {
        for (const ev of beat.events || []) {
          flat.push({ ...ev, qAbs })
          qAbs += ev.duration
        }
      }

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
          const midi     = solfaToMidi(ev.syllable, ev.octave || 0, key)
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
export function exportSolfaPDF(score, svgElement) {
  const title    = score?.title    || 'Untitled'
  const composer = score?.composer || ''
  const key      = score?.key      || 'C'
  const tempo    = score?.tempo    || 80
  const ts       = score?.timeSignature
  const parts    = score?.parts    || []

  if (!svgElement) {
    alert('Nothing to print yet — add some notes first.')
    return
  }

  // ── Collect @font-face rules from host document ──────────────────────────
  let allCSS = ''
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule.type === CSSRule.FONT_FACE_RULE) allCSS += rule.cssText + '\n'
        }
      } catch(_) {}
    }
  } catch(_) {}

  // ── Clone SVG — preserve viewBox for correct scaling ────────────────────
  const serializer = new XMLSerializer()
  const clone = svgElement.cloneNode(true)
  clone.setAttribute('xmlns',       'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  // Read the natural dimensions to build / verify viewBox
  const natW = parseFloat(svgElement.getAttribute('width'))  || svgElement.viewBox?.baseVal?.width  || 900
  const natH = parseFloat(svgElement.getAttribute('height')) || svgElement.viewBox?.baseVal?.height || 600

  // Set viewBox so the SVG knows its internal coordinate space
  clone.setAttribute('viewBox', `0 0 ${natW} ${natH}`)
  // Remove fixed pixel dimensions — let CSS/width attribute scale it
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  // Inline style: fill the container width, height auto-scales via viewBox
  clone.setAttribute('style', 'width:100%;height:auto;display:block;overflow:visible;')

  const svgStr = serializer.serializeToString(clone)

  // ── Voice labels for parts line ──────────────────────────────────────────
  const partLabels = parts.map(p => p.label || '').filter(Boolean).join(' · ')

  // ── A4 content width in px at 96dpi: 210mm = ~794px, minus 32mm margins = ~673px ──
  // We use mm throughout for print accuracy.

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    ${allCSS}

    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box }
    html, body { background: white; font-family: 'Times New Roman', Times, serif; }

    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }

    /* Screen preview */
    @media screen {
      body { background: #9ca3af; padding: 12mm 0; }
      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: white;
        box-shadow: 0 4px 24px rgba(0,0,0,0.28);
        padding: 12mm 14mm 14mm;
      }
    }

    /* Print: no wrapper needed — @page margin handles spacing */
    @media print {
      body, .page { background: white; padding: 0; margin: 0; width: auto; box-shadow: none; }
    }

    /* ── Score header ── */
    .score-header {
      text-align: center;
      margin-bottom: 6mm;
      padding-bottom: 4mm;
      border-bottom: 0.8pt solid #555;
    }
    .score-title {
      font-size: 20pt;
      font-weight: bold;
      letter-spacing: -0.01em;
      color: #111;
      margin-bottom: 2mm;
    }
    .score-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 9.5pt;
      color: #444;
      margin-top: 2mm;
    }
    .score-meta .left  { text-align: left; }
    .score-meta .right { text-align: right; font-style: italic; }

    /* ── SVG scaling ── */
    /* The SVG has a viewBox matching its natural pixel size.
       We set width to 100% of the content area and let height be auto.
       This makes it fill the A4 width perfectly. */
    .score-body svg,
    .score-body > div > svg {
      width: 100% !important;
      height: auto !important;
      display: block;
      overflow: visible;
    }
    .score-body { width: 100%; }
  </style>
</head>
<body>
  <div class="page">
    <div class="score-header">
      <div class="score-title">${title}</div>
      <div class="score-meta">
        <span class="left">Doh&nbsp;=&nbsp;${key}&nbsp;&nbsp;·&nbsp;&nbsp;${ts ? `${ts.beats}/${ts.beatType}` : '4/4'}&nbsp;&nbsp;·&nbsp;&nbsp;♩&nbsp;=&nbsp;${tempo}</span>
        <span class="right">${composer ? composer : (partLabels ? partLabels : '')}</span>
      </div>
    </div>
    <div class="score-body">${svgStr}</div>
  </div>
  <script>
    // Wait for all fonts before printing
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() {
        setTimeout(function() { window.print() }, 700)
      })
    } else {
      setTimeout(function() { window.print() }, 1200)
    }
  <\/script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    // Popup blocked — download as HTML file
    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${title.replace(/[^a-z0-9]/gi,'_')}.html`; a.click()
    URL.revokeObjectURL(url)
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
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