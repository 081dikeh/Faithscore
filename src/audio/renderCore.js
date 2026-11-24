// src/audio/renderCore.js
// Turns note events into audio, using a General MIDI SoundFont, with no
// browser APIs — it runs in a Web Worker in the app and directly in Node in the
// tests. Output is one mono "stem" per part (dry), so the mixer can set volume,
// pan, mute, solo and reverb live without re-rendering.
//
// The score is rendered in time WINDOWS (default 20 s) rather than all at once,
// so a long piece never holds minutes of multi-part audio in memory. A note that
// began before a window and is still sounding is re-started at its own start
// time, rendered from there and the earlier part discarded — so the audio is
// identical to one continuous render and windows join with no seam.
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'

export const SAMPLE_RATE = 44100
const BLOCK = 128
const DRUM_CHANNEL = 9
// ring-out after a note-off that is still rendered into the window (release tails)
export const RELEASE_TAIL_SECS = 3

export function parseSoundBank(arrayBuffer) {
  return SoundBankLoader.fromArrayBuffer(arrayBuffer)
}

// track: { id, program, drumKey?:null, unpitched?:bool, vib?:0-127, gainDb?:number,
//          events:[{ t, d, midi, vel }] }       t, d in seconds; vel 1-127
// Returns { start, length, sampleRate, stems:[{ id, data:Float32Array }] }
export async function renderWindow(bank, tracks, startSec, endSec, opts = {}) {
  const sr = opts.sampleRate || SAMPLE_RATE
  const shouldCancel = opts.shouldCancel || (() => false)
  const length = Math.max(1, Math.round((endSec - startSec) * sr))
  const stems = tracks.map((t) => ({ id: t.id, data: new Float32Array(length) }))
  const stemOf = new Map(stems.map((s) => [s.id, s]))

  // Pitched parts share one pass (one MIDI channel each, 15 at a time).
  // Each unpitched part gets its own pass: they all live on the drum channel.
  const pitched = tracks.filter((t) => !t.unpitched)
  const drums = tracks.filter((t) => t.unpitched)
  const passes = []
  for (let i = 0; i < pitched.length; i += 15) passes.push(pitched.slice(i, i + 15))
  drums.forEach((d) => passes.push([d]))

  for (const pass of passes) {
    await renderPass(bank, pass, stemOf, startSec, endSec, length, sr, shouldCancel)
    if (shouldCancel()) return null
  }
  return { start: startSec, length, sampleRate: sr, stems }
}

async function renderPass(bank, tracks, stemOf, winStart, winEnd, length, sr, shouldCancel) {
  // which events matter for this window
  const live = tracks.map((t) => ({
    t,
    events: (t.events || []).filter((e) => e.t < winEnd && e.t + e.d + RELEASE_TAIL_SECS > winStart),
  }))
  if (live.every((l) => l.events.length === 0)) return

  // Render from the earliest still-relevant note start, so held notes are exact.
  // All positions are ABSOLUTE sample numbers and the render start is snapped to
  // the synth's block grid, so every window sees the same block boundaries and
  // two windows join sample-for-sample with one continuous render.
  let minT = winStart
  for (const l of live) for (const e of l.events) if (e.t < minT) minT = e.t
  const startAbs = Math.floor((minT * sr) / BLOCK) * BLOCK
  const winStartAbs = Math.round(winStart * sr)
  const total = Math.max(1, Math.round(winEnd * sr) - startAbs)
  const skip = winStartAbs - startAbs

  const synth = new SpessaSynthProcessor(sr, { eventsEnabled: false })
  synth.soundBankManager.addSoundBank(bank, 'main')
  await synth.ready
  synth.setSystemParameter('autoAllocateVoices', true)

  // channel per track (skip the drum channel for pitched parts)
  const chans = []
  let next = 0
  for (const l of live) {
    let ch
    if (l.t.unpitched) ch = DRUM_CHANNEL
    else { if (next === DRUM_CHANNEL) next++; ch = next++ }
    chans.push(ch)
    if (!l.t.unpitched) {
      synth.programChange(ch, l.t.program ?? 0)
      synth.controllerChange(ch, 7, 127)             // channel volume: full (mix is in Web Audio)
      synth.controllerChange(ch, 10, 64)             // centre (pan is in Web Audio)
      synth.controllerChange(ch, 1, l.t.vib || 0)    // mod wheel → gentle vibrato
      synth.controllerChange(ch, 91, 0)              // no built-in reverb (added after)
      synth.controllerChange(ch, 93, 0)
    }
  }

  // sample-accurate event list
  const ons = []
  live.forEach((l, i) => {
    const gain = Math.pow(10, (l.t.gainDb || 0) / 20)
    for (const e of l.events) {
      const on = Math.round(e.t * sr) - startAbs
      const off = Math.round((e.t + e.d) * sr) - startAbs
      // unpitched parts always play their drum key (two keys, picked by pitch, for
      // pairs like high/low bongo); pitched parts play the written pitch
      const key = l.t.unpitched
        ? (l.t.drumLow != null && e.midi < 60 ? l.t.drumLow : l.t.drumKey)
        : e.midi
      if (key == null || key < 0 || key > 127) continue
      ons.push({ at: on, off: false, ch: chans[i], key, vel: e.vel, gain, ti: i })
      // drums are one-shots: a note-off would just cut the sample short
      if (!l.t.unpitched) ons.push({ at: Math.max(on + 1, off), off: true, ch: chans[i], key, ti: i })
    }
  })
  ons.sort((a, b) => a.at - b.at || (a.off === b.off ? 0 : a.off ? -1 : 1))

  const L = new Float32Array(total)
  const R = new Float32Array(total)
  // per-channel dry outputs (full length; the synth fills [startIndex, +count))
  const chOut = Array.from({ length: 16 }, () => null)
  chans.forEach((ch) => { if (!chOut[ch]) chOut[ch] = [new Float32Array(total), new Float32Array(total)] })
  const chOutArg = chOut.map((x) => x || [new Float32Array(0), new Float32Array(0)])

  let oi = 0
  let filled = 0
  let blocks = 0
  while (filled < total) {
    // fire everything that is due, then render up to the next event (or one block)
    // — so every note starts on its exact sample, not at the next block boundary
    while (oi < ons.length && ons[oi].at <= filled) {
      const e = ons[oi++]
      if (e.off) synth.noteOff(e.ch, e.key)
      else synth.noteOn(e.ch, e.key, e.vel)
    }
    let n = Math.min(BLOCK, total - filled)
    if (oi < ons.length && ons[oi].at - filled < n) n = Math.max(1, ons[oi].at - filled)
    synth.process(L, R, filled, n, chOutArg)
    filled += n
    if (++blocks % 600 === 0) {            // let the worker breathe / honour cancel
      await new Promise((r) => setTimeout(r, 0))
      if (shouldCancel()) return
    }
  }

  // copy the window out of each track's channel stem (mono = average of L/R)
  live.forEach((l, i) => {
    const [cl, cr] = chOutArg[chans[i]]
    const out = stemOf.get(l.t.id).data
    const gain = Math.pow(10, (l.t.gainDb || 0) / 20)
    const lim = Math.min(length, total - skip)
    for (let k = 0; k < lim; k++) out[k] += (cl[skip + k] + cr[skip + k]) * 0.5 * gain
  })
}