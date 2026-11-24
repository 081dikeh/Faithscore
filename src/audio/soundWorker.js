// src/audio/soundWorker.js — renders score audio off the main thread.
//   → { type:'init', soundfont:ArrayBuffer }                       ← { type:'ready' }
//   → { type:'render', job, tracks, start, end }                   ← { type:'done', job, start, length, sampleRate, stems }
//   → { type:'cancel', job }
import { parseSoundBank, renderWindow } from './renderCore.js'

let bank = null
let latestJob = 0

self.onmessage = async (ev) => {
  const m = ev.data
  try {
    if (m.type === 'init') {
      bank = parseSoundBank(m.soundfont)
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'cancel') {
      latestJob = Math.max(latestJob, m.job)
    } else if (m.type === 'render') {
      if (!bank) throw new Error('Sound bank not loaded')
      latestJob = Math.max(latestJob, m.job)
      const res = await renderWindow(bank, m.tracks, m.start, m.end, {
        shouldCancel: () => m.job < latestJob,
      })
      if (!res) { self.postMessage({ type: 'cancelled', job: m.job }); return }
      self.postMessage({ type: 'done', job: m.job, ...res }, res.stems.map((s) => s.data.buffer))
    }
  } catch (err) {
    self.postMessage({ type: 'error', job: m.job, message: String(err?.message || err) })
  }
}