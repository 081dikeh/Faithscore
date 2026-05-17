// src/hooks/useSolfaPlayback.js
// FaithScore — Cinematic SATB Choral Playback Engine
//
// Architecture:
//   For each voice part (S/A/T/B/Solo/Pno):
//     OscillatorNode (sawtooth + sine blend)
//       → FormantFilter (vowel morphing via BiquadFilter chain)
//       → Vibrato (LFO → frequency modulation)
//       → BreathNoise (filtered noise)
//       → Humanizer (tiny timing/pitch offsets)
//       → PartVolume
//       → StereoWidener (panner per voice)
//       → ChorusEffect
//       → ConvolutionReverb (cathedral IR)
//       → MasterLimiter
//       → Destination
//
// All implemented in Tone.js (already a project dependency).

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useSolfaStore, solfaToMidi, migrateMeasure } from '../store/solfaStore'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Formant frequencies for vowel "ah" (open) per voice type
// [F1, F2, F3] in Hz  — the three resonant peaks that make voice sound human
const FORMANTS = {
  soprano: { ah:[800,1150,2900], ee:[270,2400,3010], oh:[450,800,2830] },
  alto:    { ah:[800,1150,2800], ee:[270,2400,3000], oh:[450,800,2800] },
  tenor:   { ah:[650,1080,2650], ee:[290,1870,2800], oh:[400,700,2600] },
  bass:    { ah:[600,1040,2250], ee:[270,1700,2600], oh:[400,600,2400] },
  default: { ah:[700,1100,2600], ee:[270,2000,2800], oh:[430,750,2600] },
}

// Stereo pan positions: soprano right, alto left, tenor left, bass right
// Matches standard SATB choir positioning
const STEREO_PAN = { s:-0.3, a:-0.6, t:0.5, b:0.7, solo:0, piano:0 }

// Vibrato parameters per voice type
const VIBRATO = {
  soprano: { rate:5.5, depth:0.012, delay:0.35 },
  alto:    { rate:5.0, depth:0.010, delay:0.40 },
  tenor:   { rate:5.2, depth:0.011, delay:0.38 },
  bass:    { rate:4.8, depth:0.009, delay:0.42 },
  default: { rate:5.0, depth:0.010, delay:0.38 },
}

// Which vowel to use for which solfa syllable
const SYLLABLE_VOWEL = {
  d:'ah', r:'ee', m:'ah', f:'ah', s:'oh', l:'ah', t:'ee',
  de:'ee', ri:'ee', fe:'ee', se:'ee', ta:'ah',
}

// Humanization: maximum random timing offset (seconds) and pitch offset (cents)
const HUMAN_TIMING_MAX = 0.022   // up to 22ms early/late
const HUMAN_PITCH_MAX  = 8       // up to 8 cents sharp/flat

// Breath noise: short burst of filtered noise at note attack
const BREATH_DUR    = 0.08       // seconds
const BREATH_VOLUME = -28        // dB

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function midiToToneName(midi) {
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const c     = Math.max(21, Math.min(108, midi))
  return `${NAMES[c % 12]}${Math.floor(c / 12) - 1}`
}

function rand(max) { return (Math.random() - 0.5) * 2 * max }

function voiceType(partLabel) {
  const l = (partLabel||'').toLowerCase()
  if (l.startsWith('s') || l==='v') return 'soprano'
  if (l.startsWith('a'))            return 'alto'
  if (l.startsWith('t'))            return 'tenor'
  if (l.startsWith('b'))            return 'bass'
  return 'default'
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE BUILDER
// Converts the score's event model into a flat list of timed notes,
// with sustains merged, humanization offsets pre-computed.
// ─────────────────────────────────────────────────────────────────────────────
function buildSchedule(score, tempo, partMutes) {
  const bpm         = Math.max(20, Math.min(300, tempo || score.tempo || 80))
  const secPerBeat  = 60 / bpm
  const secPerQUnit = secPerBeat / 4
  const key         = score.key || 'C'
  const events      = []
  let   globalSec   = 0

  const parts = score.parts || []
  const numM  = Math.max(...parts.map(p => p.measures.length), 0)

  for (let mIdx = 0; mIdx < numM; mIdx++) {
    const refM     = migrateMeasure(parts[0]?.measures[mIdx])
    const numBeats = refM?.timeSignature?.beats || 4

    for (const part of parts) {
      if (partMutes?.[part.id]) continue

      const measure = migrateMeasure(part.measures[mIdx])
      if (!measure?.beats) continue

      const vtype  = voiceType(part.label)
      const panPos = STEREO_PAN[part.id] ?? STEREO_PAN[vtype] ?? 0

      // Flatten all events into one timeline for this measure
      const flat = []
      let qAbs = 0
      for (const beat of measure.beats) {
        for (const ev of beat.events || []) {
          flat.push({ ...ev, qAbs })
          qAbs += ev.duration
        }
      }

      // Walk events, merging sustains into preceding note
      let i = 0
      while (i < flat.length) {
        const ev = flat[i]
        if (ev.type === 'note' && ev.syllable) {
          // Accumulate sustain durations
          let totalQ = ev.duration
          let j = i + 1
          while (j < flat.length && flat[j].type === 'sustain') {
            totalQ += flat[j].duration
            j++
          }

          const nominalStart = globalSec + ev.qAbs * secPerQUnit
          const nominalDur   = totalQ * secPerQUnit

          // Humanization: vary timing and pitch slightly
          const timingOffset = rand(HUMAN_TIMING_MAX)
          const pitchOffset  = rand(HUMAN_PITCH_MAX)  // cents

          const midi     = solfaToMidi(ev.syllable, ev.octave || 0, key)
          const hz       = midiToHz(midi) * Math.pow(2, pitchOffset / 1200)
          const noteName = midiToToneName(midi)
          const vowel    = SYLLABLE_VOWEL[ev.syllable?.toLowerCase()] || 'ah'

          events.push({
            time:        Math.max(0, nominalStart + timingOffset),
            dur:         Math.max(0.1, nominalDur - 0.03),
            hz,
            noteName,
            vowel,
            vtype,
            panPos,
            partId:      part.id,
            partLabel:   part.label,
            octave:      ev.octave || 0,
            measureIndex:mIdx,
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
// CHORAL VOICE BUILDER
// Creates one "singer" channel: oscillators → formants → effects → output
// Returns { trigger(hz, dur, vowel, time), dispose() }
// ─────────────────────────────────────────────────────────────────────────────
function buildChoralVoice(vtype, panPos, outputNode) {
  const vib    = VIBRATO[vtype] || VIBRATO.default
  const fmts   = FORMANTS[vtype] || FORMANTS.default

  // ── Panner ────────────────────────────────────────────────────────────────
  const panner = new Tone.Panner(panPos).connect(outputNode)

  // ── Chorus (slight detuning between two oscillators for richness) ─────────
  const chorus = new Tone.Chorus({ frequency:1.8, delayTime:2.5, depth:0.4 })
  chorus.wet.value = 0.35
  chorus.connect(panner)
  chorus.start()

  // ── Main voice: two oscillators blended for warmth ────────────────────────
  // Oscillator 1: sawtooth (rich harmonics)
  // Oscillator 2: sine (adds fundamental warmth)
  // Both go through formant filters then merge at chorus

  // ── Formant filter bank (3 bandpass filters simulating vocal tract) ───────
  // We use EQ3 + two Tone.Filter instances
  const f1 = new Tone.Filter({ type:'bandpass', frequency: fmts.ah[0], Q:8 })
  const f2 = new Tone.Filter({ type:'bandpass', frequency: fmts.ah[1], Q:10 })
  const f3 = new Tone.Filter({ type:'bandpass', frequency: fmts.ah[2], Q:12 })

  // Blend the three formant outputs
  const formantGain1 = new Tone.Gain(0.6)
  const formantGain2 = new Tone.Gain(0.5)
  const formantGain3 = new Tone.Gain(0.3)

  formantGain1.connect(chorus)
  formantGain2.connect(chorus)
  formantGain3.connect(chorus)

  f1.connect(formantGain1)
  f2.connect(formantGain2)
  f3.connect(formantGain3)

  // ── Vibrato — use Tone.Vibrato which handles all range/param management ────
  // depth: 0-1 (proportion of pitch variation), frequency: LFO rate in Hz
  const vibratoFx = new Tone.Vibrato({
    frequency: vib.rate,
    depth:     vib.depth,   // already 0.009-0.012, well within [0,1]
    type:      'sine',
    wet:       0,           // starts silent; ramped in after attack
  })

  // ── Voice synth ───────────────────────────────────────────────────────────
  const synth = new Tone.Synth({
    oscillator: { type:'sawtooth' },
    envelope: {
      attack:  0.18,   // slow attack = natural voice onset
      decay:   0.3,
      sustain: 0.85,
      release: 0.4,
    },
    volume: -6,
  })

  const synth2 = new Tone.Synth({
    oscillator: { type:'sine' },
    envelope: {
      attack:  0.22,
      decay:   0.25,
      sustain: 0.80,
      release: 0.5,
    },
    volume: -12,
  })

  // Route: synths → vibratoFx → formant filters → formantGains → chorus
  synth.connect(vibratoFx)
  synth2.connect(vibratoFx)
  vibratoFx.connect(f1)
  vibratoFx.connect(f2)
  vibratoFx.connect(f3)

  // ── Breath noise ──────────────────────────────────────────────────────────
  const breathNoise = new Tone.NoiseSynth({
    noise:    { type:'pink' },
    envelope: { attack:0.001, decay:BREATH_DUR, sustain:0, release:0.05 },
    volume:   BREATH_VOLUME,
  })
  const breathFilter = new Tone.Filter({ type:'bandpass', frequency:3200, Q:0.5 })
  breathNoise.connect(breathFilter)
  breathFilter.connect(panner)

  // ── Trigger function ──────────────────────────────────────────────────────
  function trigger(hz, durSec, vowel, audioTime) {
    const formants = fmts[vowel] || fmts.ah

    // Set formant frequencies for this vowel
    f1.frequency.setValueAtTime(formants[0], audioTime)
    f2.frequency.setValueAtTime(formants[1], audioTime)
    f3.frequency.setValueAtTime(formants[2], audioTime)

    // Morph formants halfway through the note (vowel tail)
    const midTime = audioTime + durSec * 0.5
    f1.frequency.linearRampToValueAtTime(formants[0] * 0.95, midTime)

    // Play the note
    const noteFreq = `${hz}` // Tone accepts Hz as string or number
    synth.triggerAttackRelease(hz, durSec, audioTime, 0.82)
    synth2.triggerAttackRelease(hz * 1.002, durSec, audioTime + 0.015, 0.45) // slight detuning

    // Breath onset — short noise burst at start
    breathNoise.triggerAttackRelease(BREATH_DUR * 0.8, audioTime)

    // Vibrato: ramp wet up after natural attack delay, fade before release
    vibratoFx.wet.cancelScheduledValues(audioTime)
    vibratoFx.wet.setValueAtTime(0, audioTime)
    vibratoFx.wet.linearRampToValueAtTime(1, audioTime + vib.delay)
    vibratoFx.wet.linearRampToValueAtTime(0, audioTime + durSec - 0.05)
  }

  function dispose() {
    synth.dispose(); synth2.dispose()
    vibratoFx.dispose()
    f1.dispose(); f2.dispose(); f3.dispose()
    formantGain1.dispose(); formantGain2.dispose(); formantGain3.dispose()
    breathNoise.dispose(); breathFilter.dispose()
    chorus.dispose(); panner.dispose()
  }

  return { trigger, dispose }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOUND PRESET ENGINE
// Different "instrument" feels the user can pick from
// ─────────────────────────────────────────────────────────────────────────────
export const SOUND_PRESETS = [
  { id:'choir_african',  label:'🎤 African Church Choir',   desc:'Warm, full SATB choir with African resonance' },
  { id:'choir_cathedral',label:'🕍 Cathedral Choir',        desc:'Classical European choral sound with reverb' },
  { id:'choir_gospel',   label:'✝️ Gospel Choir',           desc:'Bright, energetic gospel feel' },
  { id:'organ',          label:'🎹 Pipe Organ',             desc:'Full church organ sound' },
  { id:'piano_choir',    label:'🎵 Piano + Choir',          desc:'Piano accompaniment with light choir' },
  { id:'strings_choir',  label:'🎻 Strings + Choir',        desc:'Orchestral strings backing the choir' },
  { id:'piano',          label:'🎹 Piano Solo',             desc:'Clean piano playback' },
]

const PRESET_PARAMS = {
  choir_african:   { reverbDecay:2.2, reverbWet:0.28, chorusDepth:0.45, masterVol:-3,  brightness:0.85 },
  choir_cathedral: { reverbDecay:4.5, reverbWet:0.45, chorusDepth:0.35, masterVol:-4,  brightness:0.65 },
  choir_gospel:    { reverbDecay:1.5, reverbWet:0.22, chorusDepth:0.55, masterVol:-2,  brightness:1.0  },
  organ:           { reverbDecay:3.5, reverbWet:0.40, chorusDepth:0.20, masterVol:-5,  brightness:0.70 },
  piano_choir:     { reverbDecay:2.0, reverbWet:0.25, chorusDepth:0.30, masterVol:-4,  brightness:0.80 },
  strings_choir:   { reverbDecay:2.8, reverbWet:0.35, chorusDepth:0.40, masterVol:-4,  brightness:0.75 },
  piano:           { reverbDecay:1.8, reverbWet:0.20, chorusDepth:0.10, masterVol:-4,  brightness:0.90 },
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────
export function useSolfaPlayback() {
  const score = useSolfaStore(s => s.score)

  // ── Audio graph refs ──────────────────────────────────────────────────────
  const reverbRef      = useRef(null)
  const masterVolRef   = useRef(null)
  const limiterRef     = useRef(null)
  const voicesRef      = useRef({})        // { partId: ChoralVoice }
  const partVolsRef    = useRef({})        // { partId: Tone.Volume }
  const partMutesRef   = useRef({})        // { partId: boolean }
  const partDbRef      = useRef({})        // { partId: number dB }
  const presetRef      = useRef('choir_african')
  const graphReadyRef  = useRef(false)

  // ── Transport refs ────────────────────────────────────────────────────────
  const rafRef         = useRef(null)
  const isPlayingRef   = useRef(false)
  const isPausedRef    = useRef(false)
  const transportStart = useRef(0)
  const seekOffsetRef  = useRef(0)
  const totalSecsRef   = useRef(0)
  const tempoRef       = useRef(80)
  const userTempoRef   = useRef(null)
  const loopRef        = useRef(false)
  const metronomeOnRef = useRef(false)
  const metronomeRef   = useRef(null)

  const onPlayingChange = useRef(null)
  const onBeatChange    = useRef(null)
  function notifyPlaying(v) { onPlayingChange.current?.(v) }
  function notifyBeat(b)    { onBeatChange.current?.(b) }

  // ── Build / rebuild the audio graph ───────────────────────────────────────
  function buildGraph(presetId) {
    // Tear down existing graph
    teardownGraph()

    const params = PRESET_PARAMS[presetId] || PRESET_PARAMS.choir_african

    // Master chain: reverb → limiter → destination
    const reverb  = new Tone.Reverb({ decay: params.reverbDecay })
    reverb.wet.value = params.reverbWet
    const limiter = new Tone.Limiter(-1)
    const masterV = new Tone.Volume(params.masterVol)
    reverb.connect(masterV)
    masterV.connect(limiter)
    limiter.toDestination()

    reverbRef.current    = reverb
    masterVolRef.current = masterV
    limiterRef.current   = limiter

    // Build one choral voice per part, each with its own Volume node
    const parts = score.parts || []
    for (const part of parts) {
      const db      = partDbRef.current[part.id] ?? 0
      const partVol = new Tone.Volume(db)
      partVol.connect(reverb)
      partVolsRef.current[part.id] = partVol

      if (partMutesRef.current[part.id]) partVol.mute = true

      const vtype   = voiceType(part.label)
      const panPos  = STEREO_PAN[part.id] ?? STEREO_PAN[vtype] ?? 0
      const voice   = buildChoralVoice(vtype, panPos, partVol)
      voicesRef.current[part.id] = voice
    }

    graphReadyRef.current = true
  }

  function teardownGraph() {
    graphReadyRef.current = false
    Object.values(voicesRef.current).forEach(v => v?.dispose())
    voicesRef.current = {}
    Object.values(partVolsRef.current).forEach(v => v?.dispose())
    partVolsRef.current = {}
    reverbRef.current?.dispose();    reverbRef.current = null
    masterVolRef.current?.dispose(); masterVolRef.current = null
    limiterRef.current?.dispose();   limiterRef.current = null
  }

  async function ensureGraph() {
    // Step 1: unlock AudioContext — MUST happen inside a user gesture call stack
    await Tone.start()
    // Step 2: wait until context is actually running
    let attempts = 0
    while (Tone.getContext().state !== 'running' && attempts < 20) {
      await new Promise(r => setTimeout(r, 100))
      attempts++
    }
    // Step 3: now it is safe to create audio nodes
    if (!graphReadyRef.current) {
      buildGraph(presetRef.current)
      await new Promise(r => setTimeout(r, 400))
    }
  }

  // ── Cursor RAF ────────────────────────────────────────────────────────────
  function startCursorLoop() {
    const tick = () => {
      if (!isPlayingRef.current) return
      const elapsed = Tone.now() - transportStart.current
      const pos     = seekOffsetRef.current + elapsed
      const total   = totalSecsRef.current
      if (pos >= total + 0.2) {
        if (loopRef.current) {
          seekOffsetRef.current = 0
          transportStart.current = Tone.now()
          notifyBeat(0)
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        doStop(false); notifyBeat(null); return
      }
      notifyBeat(Math.max(0, pos / (60 / tempoRef.current)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopCursorLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  function doStop(clearBeat=true) {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    isPlayingRef.current = false
    isPausedRef.current  = false
    notifyPlaying(false)
    stopCursorLoop()
    if (clearBeat) { notifyBeat(null); seekOffsetRef.current = 0 }
  }

  // ── Schedule & play ───────────────────────────────────────────────────────
  async function scheduleAndPlay(startSec) {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    stopCursorLoop()

    await ensureGraph()

    const effectiveTempo = userTempoRef.current || score.tempo || 80
    const schedule = buildSchedule(score, effectiveTempo, partMutesRef.current)
    totalSecsRef.current  = schedule.totalSecs
    tempoRef.current      = effectiveTempo
    seekOffsetRef.current = startSec

    if (schedule.events.length === 0) return

    const LEAD = 0.15

    for (const ev of schedule.events) {
      if (ev.time < startSec - 0.001) continue
      const relTime  = ev.time - startSec + LEAD
      const voice    = voicesRef.current[ev.partId]
      if (!voice) continue

      Tone.getTransport().schedule((audioTime) => {
        try {
          voice.trigger(ev.hz, ev.dur, ev.vowel, audioTime)
        } catch(e) { /* ignore */ }
      }, relTime)
    }

    // Metronome
    if (metronomeOnRef.current) {
      if (!metronomeRef.current) {
        metronomeRef.current = new Tone.MembraneSynth({
          pitchDecay:0.04, octaves:6, envelope:{attack:0.001,decay:0.06,sustain:0,release:0.05},
          volume:-8,
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
    Tone.getTransport().start()
    isPlayingRef.current   = true
    isPausedRef.current    = false
    notifyPlaying(true)
    transportStart.current = Tone.now() + LEAD
    setTimeout(() => { if (isPlayingRef.current) startCursorLoop() }, LEAD * 1000 + 30)
  }

  // ── Public API ────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    // Must call Tone.start() from a user gesture (button click)
    await Tone.start()
    await ensureGraph()

    if (isPausedRef.current) {
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
    Tone.getTransport().pause()
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

  // Set the sound preset and rebuild the audio graph
  const setPreset = useCallback(async (presetId) => {
    const wasPlaying = isPlayingRef.current
    const curSec = seekOffsetRef.current + (wasPlaying ? Tone.now() - transportStart.current : 0)
    doStop(false)
    presetRef.current = presetId
    teardownGraph()
    graphReadyRef.current = false
    if (wasPlaying) await scheduleAndPlay(curSec)
  }, [score])

  // Per-part volume (0-100% → dB)
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
  const onBeat    = useCallback((cb) => { onBeatChange.current = cb }, [])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      doStop(true)
      teardownGraph()
      metronomeRef.current?.dispose(); metronomeRef.current = null
    }
  }, [])

  // Rebuild graph when score parts change (new parts added)
  useEffect(() => {
    if (graphReadyRef.current) {
      teardownGraph()
    }
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