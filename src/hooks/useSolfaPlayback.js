// src/hooks/useSolfaPlayback.js
// FaithScore — SATB Choral Playback Engine (v2: realism rebuild)
//
// What changed from v1 and why:
// 1. Bass had no real low-end — every voice reused the same alto/soprano
//    "choir_aahs" samples pitched way down, which strips out chest resonance.
//    Fix: tighter per-voice sample spacing (less pitch-shift smear) + a
//    synthesized sub-bass layer under the bass choir voice for genuine
//    fundamental energy, with gentle harmonic reinforcement so it still
//    reads as "bass" on small speakers.
// 2. Piano part was *also* using choir_aahs samples (bug). Fix: real piano
//    samples.
// 3. Identical Chorus settings on every voice (depth 0.3) was the main
//    source of "slightly out of tune" — chorus works by modulating delay
//    time, which wobbles pitch. Fix: much lighter, per-voice chorus
//    (off entirely for bass), so voices don't all wobble in lockstep.
// 4. Velocity was hardcoded to 0dB for every note → totally flat dynamics,
//    a big contributor to "robotic." Fix: downbeat/weak-beat accents +
//    humanized per-note variation, actually wired up.
// 5. Notes were cut short by a fixed gap before the next one (no legato).
//    Fix: slight overlap between consecutive notes so phrases sing through
//    rather than sound clipped.
// 6. No EQ anywhere. Fix: per-voice EQ chain tailored to each voice's
//    actual problem (de-harsh soprano, presence-boost alto/tenor so they
//    don't get buried, low-shelf + de-thin bass).
// 7. Each voice now has a slightly different micro-timing lean (bass lays
//    back a touch, soprano sits a touch forward) — small, but it's part of
//    why a real choir doesn't sound quantized.
// 8. Added a gentle master-bus compressor to glue the mix together.

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useSolfaStore, solfaToMidi, migrateMeasure } from '../store/solfaStore'

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE MAPS
// Using gleitz/midi-js-soundfonts hosted on GitHub (free, no CORS issues).
// ─────────────────────────────────────────────────────────────────────────────

const SF_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'

const VOICE_PROGRAM = {
  soprano: 'choir_aahs',
  alto:    'choir_aahs',
  tenor:   'choir_aahs',
  bass:    'choir_aahs',
  piano:   'acoustic_grand_piano',
  default: 'choir_aahs',
}

function buildSampleUrls(program, notes) {
  const urls = {}
  for (const note of notes) {
    const encoded = note.replace('#', 's')
    urls[note] = `${SF_BASE}/${program}-mp3/${encoded}.mp3`
  }
  return urls
}

// Tighter spacing per voice (2nd/3rd apart) so the Sampler interpolates
// over a narrower pitch-shift range — less formant smear, more natural tone.
const SAMPLE_NOTES = {
  soprano: ['A4','C5','D5','F5','G5','A5','C6'],
  alto:    ['E4','G4','A4','C5','D5','F5'],
  tenor:   ['A3','C4','D4','F4','G4','A4'],
  bass:    ['C3','D3','F3','G3','A3','C4'],
  piano:   ['A0','C2','E2','G2','C3','E3','G3','C4','E4','G4','C5','E5','G5','C6','C7'],
  default: ['C3','E3','G3','C4','E4','G4','C5'],
}

// Per-voice attack/release — bass is physically slower to "speak" than soprano.
const VOICE_ATTACK  = { soprano:0.045, alto:0.05, tenor:0.06, bass:0.09, piano:0.002, solo:0.05, default:0.06 }
const VOICE_RELEASE = { soprano:0.45,  alto:0.5,  tenor:0.55, bass:0.7,  piano:0.3,   solo:0.45, default:0.5  }

// Standard SATB stereo spread, left to right: S A T B
const STEREO_PAN = { s:-0.65, a:-0.22, t:0.22, b:0.65, solo:0, piano:0.05 }

// Per-voice EQ — each one targets a specific complaint:
//  - soprano: tame the 2.5–3.5kHz harshness pitch-shifted samples get
//  - alto/tenor: presence boost so they cut through instead of getting buried
//  - bass: low-shelf boost for real weight, mid scoop to avoid mud,
//          high tamed so it doesn't read as thin/synthetic
const VOICE_EQ = {
  soprano: [
    { type: 'peaking',  frequency: 3000, Q: 1.1, gain: -4 },
    { type: 'highshelf', frequency: 8000, gain: 1.5 },
  ],
  alto: [
    { type: 'lowshelf', frequency: 220,  gain: -2 },
    { type: 'peaking',  frequency: 1500, Q: 1.0, gain: 3 },
  ],
  tenor: [
    { type: 'peaking',   frequency: 1200, Q: 1.0, gain: 4 },
    { type: 'highshelf', frequency: 5000, gain: -2 },
  ],
  bass: [
    { type: 'lowshelf', frequency: 130,  gain: 5 },
    { type: 'peaking',  frequency: 500,  Q: 1.0, gain: -3 },
    { type: 'highshelf', frequency: 3500, gain: -5 },
  ],
  piano: [],
  solo: [
    { type: 'peaking', frequency: 2500, Q: 1.0, gain: -2 },
  ],
  default: [],
}

// Per-voice chorus — much lighter than before, and OFF for bass entirely
// (chorus's delay-modulation is what was reading as "out of tune," and bass
// needs to stay solid, not shimmer). Slightly different rates per voice so
// they don't all wobble in sync.
const VOICE_CHORUS = {
  soprano: { frequency: 1.3, delayTime: 2.0, depth: 0.18, wet: 0.16, spread: 90 },
  alto:    { frequency: 1.0, delayTime: 2.4, depth: 0.15, wet: 0.14, spread: 90 },
  tenor:   { frequency: 0.8, delayTime: 2.8, depth: 0.12, wet: 0.10, spread: 90 },
  bass:    null,
  piano:   null,
  solo:    { frequency: 1.1, delayTime: 2.2, depth: 0.14, wet: 0.12, spread: 90 },
  default: { frequency: 1.0, delayTime: 2.2, depth: 0.15, wet: 0.14, spread: 90 },
}

// Small per-voice timing lean (seconds) — real ensembles aren't perfectly
// aligned; basses tend to sit a hair behind the beat, sopranos a hair ahead.
const VOICE_TIMING_LEAN = { soprano: -0.003, alto: 0, tenor: 0.003, bass: 0.008, piano: 0, solo: 0, default: 0 }

// Small per-voice loudness compensation — low fundamentals read as quieter
// than they measure (equal-loudness contours), especially on phone speakers.
const VOICE_GAIN_TRIM = { soprano: -1, alto: 0, tenor: 0.5, bass: 1.5, piano: 0, solo: 0, default: 0 }

// Humanization constants
const HUMAN_TIMING_MAX = 0.016   // random micro-timing jitter, seconds
const HUMAN_PITCH_MAX  = 3        // cents — subtle, was 6 (too much → "out of tune")
const HUMAN_VEL_MAX     = 1.0     // dB jitter on top of accent dynamics

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function rand(max) { return (Math.random() - 0.5) * 2 * max }

function voiceType(partLabel) {
  const l = (partLabel || '').toLowerCase()
  if (l.startsWith('pno') || l.startsWith('piano')) return 'piano'
  if (l === 'solo' || l === 'voice' || l === 'v')    return 'solo'
  if (l.startsWith('s'))                              return 'soprano'
  if (l.startsWith('a'))                              return 'alto'
  if (l.startsWith('t'))                              return 'tenor'
  if (l.startsWith('b'))                              return 'bass'
  return 'default'
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildSchedule(score, tempo, partMutes) {
  const bpm         = Math.max(20, Math.min(300, tempo || score.tempo || 80))
  const secPerBeat  = 60 / bpm
  const secPerQUnit = secPerBeat / 4
  const key         = score.key || 'C'
  const events      = []
  let globalSec     = 0

  const parts = score.parts || []
  const numM  = Math.max(...parts.map(p => p.measures.length), 0)

  for (let mIdx = 0; mIdx < numM; mIdx++) {
    const refM     = migrateMeasure(parts[0]?.measures[mIdx])
    const numBeats = refM?.timeSignature?.beats || 4

    for (const part of parts) {
      if (partMutes?.[part.id]) continue

      const measure = migrateMeasure(part.measures[mIdx])
      if (!measure?.beats) continue

      const vtype   = voiceType(part.label)
      const panPos  = STEREO_PAN[part.id] ?? STEREO_PAN[vtype] ?? 0
      const lean    = VOICE_TIMING_LEAN[vtype] ?? 0
      const gainTrim = VOICE_GAIN_TRIM[vtype] ?? 0

      // Flatten all events in this measure with absolute quarter-unit offset
      const flat = []
      let qAbs = 0
      for (const beat of measure.beats) {
        for (const ev of beat.events || []) {
          flat.push({ ...ev, qAbs })
          qAbs += ev.duration
        }
      }

      // Walk events, merging sustains into preceding note, and look ahead
      // to the next note for a small legato overlap.
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

          const nominalStart = globalSec + ev.qAbs * secPerQUnit
          const nominalDur   = totalQ * secPerQUnit

          // legato overlap — small, scaled to note length so short notes
          // don't overlap disproportionately
          const overlap = Math.min(0.05, nominalDur * 0.15)

          const timingOffset = rand(HUMAN_TIMING_MAX) + lean
          const pitchOffsetCents = rand(HUMAN_PITCH_MAX)

          const midi        = solfaToMidi(ev.syllable, ev.octave || 0, key)
          const pitchedMidi = midi + pitchOffsetCents / 100
          const hz          = midiToHz(pitchedMidi)

          // Dynamics: accent measure-downbeats, lighten weak subdivisions,
          // then layer in a little humanized jitter so no two notes are
          // identically loud.
          const isMeasureStart = ev.qAbs === 0
          const isBeatStart    = ev.qAbs % 4 === 0
          let accentDb = isMeasureStart ? 1.8 : (isBeatStart ? 0.8 : -0.6)
          const velocityDb = accentDb + gainTrim + rand(HUMAN_VEL_MAX)

          events.push({
            time:         Math.max(0, nominalStart + timingOffset),
            dur:          Math.max(0.1, nominalDur - 0.025 + overlap),
            hz,
            vtype,
            panPos,
            partId:       part.id,
            partLabel:    part.label,
            measureIndex: mIdx,
            velocityDb,
          })

          i = j
        } else {
          i++
        }
      }
    }

    globalSec += numBeats * secPerBeat
  }

  events.sort((a, b) => a.time - b.time)
  return { events, totalSecs: globalSec, tempo: bpm }
}

// ─────────────────────────────────────────────────────────────────────────────
// EQ CHAIN
// Returns { input, output, dispose }. If a voice has no EQ bands defined,
// input === output is a transparent passthrough Gain node.
// ─────────────────────────────────────────────────────────────────────────────
function buildEQChain(vtype) {
  const bands = VOICE_EQ[vtype] || []
  if (bands.length === 0) {
    const passthrough = new Tone.Gain(1)
    return { input: passthrough, output: passthrough, dispose: () => { try { passthrough.dispose() } catch (_) {} } }
  }
  const filters = bands.map(b => new Tone.Filter({
    type: b.type, frequency: b.frequency, Q: b.Q ?? 0.9, gain: b.gain ?? 0,
  }))
  for (let k = 0; k < filters.length - 1; k++) filters[k].connect(filters[k + 1])
  return {
    input:  filters[0],
    output: filters[filters.length - 1],
    dispose: () => filters.forEach(f => { try { f.dispose() } catch (_) {} }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE CHANNEL
// One Sampler (+ optional sub-bass synth layer for the bass voice) per part.
// Chain: Sampler → EQ → [Chorus] → Panner → (partVolume passed in as
// outputNode) → shared reverb bus.
// The bass sub-layer bypasses the choir EQ (it's tuned for sample artifacts,
// not a pure tone) and goes Synth → Distortion (gentle, for harmonic
// presence on small speakers) → Lowpass (tame the added harmonics) → Panner.
// ─────────────────────────────────────────────────────────────────────────────
function buildVoiceChannel(vtype, panPos, outputNode, onLoad) {
  const program = VOICE_PROGRAM[vtype] || VOICE_PROGRAM.default
  const notes   = SAMPLE_NOTES[vtype]  || SAMPLE_NOTES.default
  const urls    = buildSampleUrls(program, notes)

  const panner = new Tone.Panner(panPos).connect(outputNode)
  const eq     = buildEQChain(vtype)

  const chorusSettings = VOICE_CHORUS[vtype]
  let chorus = null
  if (chorusSettings) {
    chorus = new Tone.Chorus(chorusSettings).start()
    eq.output.connect(chorus)
    chorus.connect(panner)
  } else {
    eq.output.connect(panner)
  }

  const sampler = new Tone.Sampler({
    urls,
    attack:  VOICE_ATTACK[vtype]  ?? 0.06,
    release: VOICE_RELEASE[vtype] ?? 0.5,
    onload:  onLoad,
  }).connect(eq.input)

  // ── Sub-bass reinforcement layer (bass voice only) ──────────────────────
  let subSynth = null, subDist = null, subLpf = null
  if (vtype === 'bass') {
    subSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsine', count: 3, spread: 12 },
      envelope:   { attack: 0.09, decay: 0.25, sustain: 0.85, release: 0.5 },
    })
    subSynth.volume.value = -11

    subDist = new Tone.Distortion({ distortion: 0.12, wet: 0.35 })
    subLpf  = new Tone.Filter({ type: 'lowpass', frequency: 1800, Q: 0.5 })

    subSynth.connect(subDist)
    subDist.connect(subLpf)
    subLpf.connect(panner)
  }

  function trigger(hz, durSec, audioTime, velocityDb) {
    try {
      const vel = Math.min(1, Math.max(0.05, Math.pow(10, (velocityDb ?? 0) / 20)))
      sampler.triggerAttackRelease(hz, durSec, audioTime, vel)
      if (subSynth) subSynth.triggerAttackRelease(hz, durSec, audioTime, vel)
    } catch (_) {}
  }

  function dispose() {
    try { sampler.dispose() } catch (_) {}
    try { chorus?.dispose() } catch (_) {}
    try { eq.dispose() } catch (_) {}
    try { panner.dispose() } catch (_) {}
    try { subSynth?.dispose() } catch (_) {}
    try { subDist?.dispose() } catch (_) {}
    try { subLpf?.dispose() } catch (_) {}
  }

  return { trigger, dispose, sampler }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOUND PRESETS
// ─────────────────────────────────────────────────────────────────────────────
export const SOUND_PRESETS = [
  { id:'choir_african',   label:'🎤 African Church Choir',  desc:'Warm, full SATB choir' },
  { id:'choir_cathedral', label:'🕍 Cathedral Choir',       desc:'Classical choral sound with long reverb' },
  { id:'choir_gospel',    label:'✝️ Gospel Choir',          desc:'Bright, energetic gospel feel' },
  { id:'piano',           label:'🎹 Piano Solo',            desc:'Clean piano playback' },
]

const PRESET_PARAMS = {
  choir_african:   { reverbDecay:2.2, reverbWet:0.26, masterVol:-2  },
  choir_cathedral: { reverbDecay:5.0, reverbWet:0.48, masterVol:-4  },
  choir_gospel:    { reverbDecay:1.4, reverbWet:0.20, masterVol:-1  },
  piano:           { reverbDecay:1.8, reverbWet:0.18, masterVol:-3  },
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────
export function useSolfaPlayback() {
  const score = useSolfaStore(s => s.score)

  // Audio graph
  const reverbRef        = useRef(null)
  const masterVolRef     = useRef(null)
  const compRef          = useRef(null)
  const limiterRef       = useRef(null)
  const voicesRef        = useRef({})
  const partVolsRef      = useRef({})
  const partMutesRef     = useRef({})
  const partDbRef        = useRef({})
  const presetRef        = useRef('choir_african')
  const graphReadyRef    = useRef(false)
  const samplesLoadedRef = useRef(false)

  // Transport
  const rafRef          = useRef(null)
  const isPlayingRef    = useRef(false)
  const isPausedRef     = useRef(false)
  const transportStart  = useRef(0)
  const seekOffsetRef   = useRef(0)
  const totalSecsRef    = useRef(0)
  const tempoRef        = useRef(80)
  const userTempoRef    = useRef(null)
  const loopRef         = useRef(false)
  const metronomeOnRef  = useRef(false)
  const metronomeRef    = useRef(null)

  const onPlayingChange = useRef(null)
  const beatListeners   = useRef(new Set())
  function notifyPlaying(v) { onPlayingChange.current?.(v) }
  function notifyBeat(b)    { beatListeners.current.forEach(cb => { try { cb(b) } catch (_) {} }) }

  // ── Build audio graph ──────────────────────────────────────────────────────
  function buildGraph(presetId) {
    teardownGraph()

    const params  = PRESET_PARAMS[presetId] || PRESET_PARAMS.choir_african
    const reverb  = new Tone.Reverb({ decay: params.reverbDecay, preDelay: 0.02 })
    reverb.wet.value = params.reverbWet

    // Gentle bus compressor to glue the ensemble together.
    const comp = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.05, release: 0.25 })
    const limiter = new Tone.Limiter(-1)
    const masterV = new Tone.Volume(params.masterVol)

    reverb.connect(masterV)
    masterV.connect(comp)
    comp.connect(limiter)
    limiter.toDestination()

    reverbRef.current    = reverb
    masterVolRef.current = masterV
    compRef.current       = comp
    limiterRef.current   = limiter

    samplesLoadedRef.current = false
    let loadCount    = 0
    const parts      = score.parts || []
    const totalParts = parts.length || 1

    for (const part of parts) {
      const db      = partDbRef.current[part.id] ?? 0
      const partVol = new Tone.Volume(db)
      partVol.connect(reverb)
      partVolsRef.current[part.id] = partVol
      if (partMutesRef.current[part.id]) partVol.mute = true

      const vtype  = voiceType(part.label)
      const panPos = STEREO_PAN[part.id] ?? STEREO_PAN[vtype] ?? 0

      const voice = buildVoiceChannel(vtype, panPos, partVol, () => {
        loadCount++
        if (loadCount >= totalParts) samplesLoadedRef.current = true
      })
      voicesRef.current[part.id] = voice
    }

    graphReadyRef.current = true
  }

  function teardownGraph() {
    graphReadyRef.current    = false
    samplesLoadedRef.current = false
    Object.values(voicesRef.current).forEach(v => { try { v?.dispose() } catch (_) {} })
    voicesRef.current = {}
    Object.values(partVolsRef.current).forEach(v => { try { v?.dispose() } catch (_) {} })
    partVolsRef.current = {}
    try { reverbRef.current?.dispose()    } catch (_) {} ; reverbRef.current    = null
    try { compRef.current?.dispose()       } catch (_) {} ; compRef.current       = null
    try { masterVolRef.current?.dispose() } catch (_) {} ; masterVolRef.current = null
    try { limiterRef.current?.dispose()   } catch (_) {} ; limiterRef.current   = null
  }

  async function ensureGraph() {
    await Tone.start()
    let attempts = 0
    while (Tone.getContext().state !== 'running' && attempts < 20) {
      await new Promise(r => setTimeout(r, 100))
      attempts++
    }
    if (!graphReadyRef.current) {
      buildGraph(presetRef.current)
      await new Promise(r => setTimeout(r, 600))
    }
    let sWait = 0
    while (!samplesLoadedRef.current && sWait < 40) {
      await new Promise(r => setTimeout(r, 100))
      sWait++
    }
  }

  // ── Cursor RAF ─────────────────────────────────────────────────────────────
  function startCursorLoop() {
    stopCursorLoop()
    const tick = () => {
      if (!isPlayingRef.current) return
      const elapsed = Tone.now() - transportStart.current
      const pos     = seekOffsetRef.current + elapsed
      const total   = totalSecsRef.current

      if (pos >= total - 0.05) {
        if (loopRef.current) {
          Tone.getTransport().stop()
          Tone.getTransport().cancel()
          seekOffsetRef.current = 0
          _doSchedule(0).then(() => {
            Tone.getTransport().start()
            transportStart.current = Tone.now()
            notifyBeat(0)
            rafRef.current = requestAnimationFrame(tick)
          })
          return
        }
        doStop(false)
        notifyBeat(null)
        return
      }

      notifyBeat(Math.max(0, pos / (60 / tempoRef.current)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopCursorLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  function doStop(clearBeat = true) {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    isPlayingRef.current = false
    isPausedRef.current  = false
    notifyPlaying(false)
    stopCursorLoop()
    if (clearBeat) { notifyBeat(null); seekOffsetRef.current = 0 }
  }

  // ── Inner schedule function (no Transport start) ───────────────────────────
  async function _doSchedule(startSec) {
    const effectiveTempo  = userTempoRef.current || score.tempo || 80
    const schedule        = buildSchedule(score, effectiveTempo, partMutesRef.current)
    totalSecsRef.current  = schedule.totalSecs
    tempoRef.current      = effectiveTempo
    seekOffsetRef.current = startSec

    if (schedule.events.length === 0) return

    const LEAD = 0.12

    for (const ev of schedule.events) {
      if (ev.time < startSec - 0.001) continue
      const relTime = ev.time - startSec + LEAD
      const voice   = voicesRef.current[ev.partId]
      if (!voice) continue

      Tone.getTransport().schedule((audioTime) => {
        voice.trigger(ev.hz, ev.dur, audioTime, ev.velocityDb)
      }, relTime)
    }

    // Metronome
    if (metronomeOnRef.current) {
      if (!metronomeRef.current) {
        metronomeRef.current = new Tone.MembraneSynth({
          pitchDecay: 0.04, octaves: 6,
          envelope: { attack:0.001, decay:0.06, sustain:0, release:0.05 },
          volume: -8,
        }).toDestination()
      }
      const met       = metronomeRef.current
      const spb       = 60 / effectiveTempo
      const remaining = schedule.totalSecs - startSec
      const numBeats  = Math.ceil(remaining / spb)
      const startBeat = Math.floor(startSec / spb)
      const bInBar    = score.timeSignature?.beats || 4
      for (let b = 0; b < numBeats; b++) {
        const t = b * spb + LEAD
        Tone.getTransport().schedule((audioTime) => {
          const isDown = (startBeat + b) % bInBar === 0
          met.triggerAttackRelease(isDown ? 'C2' : 'C3', '16n', audioTime)
        }, t)
      }
    }

    Tone.getTransport().bpm.value = effectiveTempo
  }

  // ── Full scheduleAndPlay (stops Transport, reschedules, starts) ────────────
  async function scheduleAndPlay(startSec) {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    stopCursorLoop()

    await ensureGraph()
    await _doSchedule(startSec)

    if ((totalSecsRef.current - startSec) < 0.1) return

    Tone.getTransport().start()
    isPlayingRef.current   = true
    isPausedRef.current    = false
    notifyPlaying(true)
    transportStart.current = Tone.now()
    startCursorLoop()
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    await Tone.start()
    await ensureGraph()

    if (isPausedRef.current) {
      const resumeSec = seekOffsetRef.current
      Tone.getTransport().stop()
      Tone.getTransport().cancel()
      await _doSchedule(resumeSec)
      Tone.getTransport().start()
      isPlayingRef.current   = true
      isPausedRef.current    = false
      notifyPlaying(true)
      transportStart.current = Tone.now()
      startCursorLoop()
      return
    }
    await scheduleAndPlay(0)
  }, [score])

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return
    seekOffsetRef.current += Tone.now() - transportStart.current
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    isPlayingRef.current = false
    isPausedRef.current  = true
    notifyPlaying(false)
    stopCursorLoop()
  }, [])

  const stop = useCallback(() => doStop(true), [])

  const seekToBeat = useCallback(async (beat) => {
    await Tone.start()
    const sec = Math.max(0, beat * (60 / (userTempoRef.current || score.tempo || 80)))
    notifyBeat(beat)
    if (isPlayingRef.current || isPausedRef.current) await scheduleAndPlay(sec)
    else seekOffsetRef.current = sec
  }, [score])

  const setTempo = useCallback((bpm) => {
    userTempoRef.current = bpm ? Math.max(20, Math.min(300, bpm)) : null
    if (isPlayingRef.current) {
      const cur = seekOffsetRef.current + (Tone.now() - transportStart.current)
      scheduleAndPlay(cur)
    }
  }, [score])

  const setPreset = useCallback(async (presetId) => {
    const wasPlaying = isPlayingRef.current
    const curSec = seekOffsetRef.current + (wasPlaying ? Tone.now() - transportStart.current : 0)
    doStop(false)
    presetRef.current = presetId
    teardownGraph()
    if (wasPlaying) await scheduleAndPlay(curSec)
  }, [score])

  const setPartVolume = useCallback((partId, pct) => {
    const db = pct <= 0 ? -60 : 20 * Math.log10(Math.max(0.001, pct / 100))
    partDbRef.current[partId] = db
    if (partVolsRef.current[partId]) partVolsRef.current[partId].volume.value = db
  }, [])

  const setPartMute = useCallback((partId, muted) => {
    partMutesRef.current[partId] = muted
    if (partVolsRef.current[partId]) partVolsRef.current[partId].mute = muted
  }, [])

  const getPartVolume = useCallback((partId) => {
    const db = partDbRef.current[partId] ?? 0
    return db <= -60 ? 0 : Math.round(Math.pow(10, db / 20) * 100)
  }, [])

  const getPartMuted = useCallback((partId) => partMutesRef.current[partId] ?? false, [])

  const toggleMetronome = useCallback(() => {
    metronomeOnRef.current = !metronomeOnRef.current
    return metronomeOnRef.current
  }, [])

  const toggleLoop = useCallback(() => {
    loopRef.current = !loopRef.current
    return loopRef.current
  }, [])

  const getCurrentSec = useCallback(() => {
    if (!isPlayingRef.current && !isPausedRef.current) return 0
    if (isPausedRef.current) return seekOffsetRef.current
    return seekOffsetRef.current + (Tone.now() - transportStart.current)
  }, [])

  const getTotalSecs    = useCallback(() => totalSecsRef.current, [])
  const getCurrentTempo = useCallback(() => userTempoRef.current || score.tempo || 80, [score])
  const getPreset       = useCallback(() => presetRef.current, [])

  const onPlaying = useCallback((cb) => { onPlayingChange.current = cb }, [])
  const onBeat    = useCallback((cb) => {
    beatListeners.current.add(cb)
    return () => beatListeners.current.delete(cb)
  }, [])

  useEffect(() => {
    return () => {
      doStop(true)
      teardownGraph()
      try { metronomeRef.current?.dispose() } catch (_) {} ; metronomeRef.current = null
    }
  }, [])

  useEffect(() => {
    if (graphReadyRef.current) teardownGraph()
  }, [score.parts?.length, score.voiceCombo])

  return {
    play, pause, stop, seekToBeat, setTempo, setPreset, getPreset,
    toggleMetronome, toggleLoop,
    getCurrentSec, getTotalSecs, getCurrentTempo,
    setPartVolume, setPartMute, getPartVolume, getPartMuted,
    onPlaying, onBeat,
    isMetronomeOn: () => metronomeOnRef.current,
    isLooping:     () => loopRef.current,
    isPaused:      () => isPausedRef.current,
    isPlaying:     () => isPlayingRef.current,
  }
}