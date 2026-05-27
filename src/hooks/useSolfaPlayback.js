// src/hooks/useSolfaPlayback.js
// FaithScore — SATB Choral Playback Engine
// Uses Tone.Sampler with real soundfont samples for MuseScore-quality playback.
// Loop fix: on loop, Transport is fully stopped+cancelled before restart.

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useSolfaStore, solfaToMidi, migrateMeasure } from '../store/solfaStore'

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE MAPS
// Using gleitz/midi-js-soundfonts hosted on GitHub (free, no CORS issues).
// Each voice gets a curated set of sample pitches; Sampler interpolates between.
// ─────────────────────────────────────────────────────────────────────────────

const SF_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'

// GM program numbers → folder names
// Choir Aahs = 52, Voice Oohs = 53, Synth Voice = 54,
// Tenor Sax (warm) = 66, String Ensemble = 48, Church Organ = 19
const VOICE_PROGRAM = {
  soprano: 'choir_aahs',
  alto:    'choir_aahs',
  tenor:   'choir_aahs',
  bass:    'choir_aahs',
  default: 'choir_aahs',
}

// Sampler note URLs — pick a spread of pitches for accurate interpolation
function buildSampleUrls(program, notes) {
  const urls = {}
  for (const note of notes) {
    // gleitz CDN: note name uses 'b' for flat, e.g. Bb4 → Bb4.mp3
    const encoded = note.replace('#', 's')  // C#4 → Cs4
    urls[note] = `${SF_BASE}/${program}-mp3/${encoded}.mp3`
  }
  return urls
}

// Sample pitches per voice type — well spread so interpolation is accurate
const SAMPLE_NOTES = {
  soprano: ['C4','E4','G4','C5','E5','G5','C6'],
  alto:    ['G3','C4','E4','G4','C5','E5'],
  tenor:   ['C3','E3','G3','C4','E4','G4','C5'],
  bass:    ['C2','E2','G2','C3','E3','G3','C4'],
  default: ['C3','E3','G3','C4','E4','G4','C5'],
}

// Stereo pan: classic SATB choir layout
const STEREO_PAN = { s:-0.3, a:-0.6, t:0.5, b:0.7, solo:0, piano:0 }

// Humanization constants
const HUMAN_TIMING_MAX = 0.018  // 18ms max timing variation
const HUMAN_PITCH_MAX  = 6      // 6 cents max pitch variation

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function midiToNoteName(midi) {
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const c = Math.max(21, Math.min(108, midi))
  return `${NAMES[c % 12]}${Math.floor(c / 12) - 1}`
}

function rand(max) { return (Math.random() - 0.5) * 2 * max }

function voiceType(partLabel) {
  const l = (partLabel || '').toLowerCase()
  if (l.startsWith('s') || l === 'v') return 'soprano'
  if (l.startsWith('a'))              return 'alto'
  if (l.startsWith('t'))              return 'tenor'
  if (l.startsWith('b'))              return 'bass'
  return 'default'
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildSchedule(score, tempo, partMutes) {
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
      if (partMutes?.[part.id]) continue

      const measure = migrateMeasure(part.measures[mIdx])
      if (!measure?.beats) continue

      const vtype  = voiceType(part.label)
      const panPos = STEREO_PAN[part.id] ?? STEREO_PAN[vtype] ?? 0

      // Flatten all events
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
          let totalQ = ev.duration
          let j = i + 1
          while (j < flat.length && flat[j].type === 'sustain') {
            totalQ += flat[j].duration
            j++
          }

          const nominalStart = globalSec + ev.qAbs * secPerQUnit
          const nominalDur   = totalQ * secPerQUnit

          const timingOffset = rand(HUMAN_TIMING_MAX)
          const pitchOffset  = rand(HUMAN_PITCH_MAX)  // cents

          const midi     = solfaToMidi(ev.syllable, ev.octave || 0, key)
          // Apply pitch humanization by shifting midi slightly
          const pitchedMidi = midi + pitchOffset / 100  // fractional midi for hz calc
          const hz       = midiToHz(pitchedMidi)
          const noteName = midiToNoteName(midi)

          events.push({
            time:         Math.max(0, nominalStart + timingOffset),
            dur:          Math.max(0.08, nominalDur - 0.025),
            noteName,
            hz,
            vtype,
            panPos,
            partId:       part.id,
            partLabel:    part.label,
            measureIndex: mIdx,
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
// VOICE CHANNEL
// One Sampler per voice type, shared by all parts of that type.
// Chain: Sampler → Volume → Panner → (shared reverb output)
// ─────────────────────────────────────────────────────────────────────────────
function buildVoiceChannel(vtype, panPos, outputNode, onLoad) {
  const program  = VOICE_PROGRAM[vtype] || VOICE_PROGRAM.default
  const notes    = SAMPLE_NOTES[vtype]  || SAMPLE_NOTES.default
  const urls     = buildSampleUrls(program, notes)

  const panner   = new Tone.Panner(panPos).connect(outputNode)

  // Gentle chorus to give body / thickness to sampled voices
  const chorus   = new Tone.Chorus({ frequency: 1.6, delayTime: 2.2, depth: 0.3, wet: 0.28 })
  chorus.start()
  chorus.connect(panner)

  const sampler  = new Tone.Sampler({
    urls,
    attack:  0.06,   // natural voice onset
    release: 0.5,
    onload:  onLoad,
  }).connect(chorus)

  function trigger(noteName, durSec, audioTime, velocityDb) {
    try {
      // velocity as gain: 0 dB = full, negative = quieter
      const vel = Math.pow(10, (velocityDb ?? 0) / 20)
      sampler.triggerAttackRelease(noteName, durSec, audioTime, Math.min(1, Math.max(0.1, vel)))
    } catch (_) {}
  }

  function dispose() {
    try { sampler.dispose() } catch (_) {}
    try { chorus.dispose()  } catch (_) {}
    try { panner.dispose()  } catch (_) {}
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
  const reverbRef      = useRef(null)
  const masterVolRef   = useRef(null)
  const limiterRef     = useRef(null)
  const voicesRef      = useRef({})      // { partId: VoiceChannel }
  const partVolsRef    = useRef({})      // { partId: Tone.Volume }
  const partMutesRef   = useRef({})
  const partDbRef      = useRef({})
  const presetRef      = useRef('choir_african')
  const graphReadyRef  = useRef(false)
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
  const onBeatChange    = useRef(null)
  function notifyPlaying(v) { onPlayingChange.current?.(v) }
  function notifyBeat(b)    { onBeatChange.current?.(b) }

  // ── Build audio graph ──────────────────────────────────────────────────────
  function buildGraph(presetId) {
    teardownGraph()

    const params  = PRESET_PARAMS[presetId] || PRESET_PARAMS.choir_african
    const reverb  = new Tone.Reverb({ decay: params.reverbDecay, preDelay: 0.02 })
    reverb.wet.value = params.reverbWet
    const limiter = new Tone.Limiter(-1)
    const masterV = new Tone.Volume(params.masterVol)
    reverb.connect(masterV)
    masterV.connect(limiter)
    limiter.toDestination()

    reverbRef.current    = reverb
    masterVolRef.current = masterV
    limiterRef.current   = limiter

    samplesLoadedRef.current = false
    let loadCount   = 0
    const parts     = score.parts || []
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
    Object.values(voicesRef.current).forEach(v => { try { v?.dispose() } catch(_){} })
    voicesRef.current = {}
    Object.values(partVolsRef.current).forEach(v => { try { v?.dispose() } catch(_){} })
    partVolsRef.current = {}
    try { reverbRef.current?.dispose()    } catch(_){} ; reverbRef.current    = null
    try { masterVolRef.current?.dispose() } catch(_){} ; masterVolRef.current = null
    try { limiterRef.current?.dispose()   } catch(_){} ; limiterRef.current   = null
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
      // Wait for reverb IR + sample load (up to 3s)
      await new Promise(r => setTimeout(r, 600))
    }
    // Wait for samples to finish loading (up to 4s more)
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
          // ── LOOP: full stop → reschedule from 0 ───────────────────────────
          // Must fully stop Transport before rescheduling, or new events
          // scheduled via cancel()+schedule() won't fire on a running transport.
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
        voice.trigger(ev.noteName, ev.dur, audioTime, 0)
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

    if ((totalSecsRef.current - startSec) < 0.1) return  // nothing to play

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
      // Resume from pause position — reschedule remaining events
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
    // Capture current position before stopping
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

  const getPartMuted  = useCallback((partId) => partMutesRef.current[partId] ?? false, [])

  const toggleMetronome = useCallback(() => {
    metronomeOnRef.current = !metronomeOnRef.current
    return metronomeOnRef.current
  }, [])

  const toggleLoop = useCallback(() => {
    loopRef.current = !loopRef.current
    return loopRef.current
  }, [])

  const getCurrentSec   = useCallback(() => {
    if (!isPlayingRef.current && !isPausedRef.current) return 0
    if (isPausedRef.current) return seekOffsetRef.current
    return seekOffsetRef.current + (Tone.now() - transportStart.current)
  }, [])

  const getTotalSecs    = useCallback(() => totalSecsRef.current, [])
  const getCurrentTempo = useCallback(() => userTempoRef.current || score.tempo || 80, [score])
  const getPreset       = useCallback(() => presetRef.current, [])

  const onPlaying = useCallback((cb) => { onPlayingChange.current = cb }, [])
  const onBeat    = useCallback((cb) => { onBeatChange.current    = cb }, [])

  useEffect(() => {
    return () => {
      doStop(true)
      teardownGraph()
      try { metronomeRef.current?.dispose() } catch(_){} ; metronomeRef.current = null
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