// src/hooks/usePlayback.js
// FaithScore — Full playback system with seek, tempo control, loop, metronome
// Web Audio / Tone.js based. Sampler (real piano) with FM synth fallback.

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useScoreStore, noteDuration, measureCapacity } from '../store/scoreStore'

// ── SAMPLER CONFIG ────────────────────────────────────────────────────────────
const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'
const SAMPLE_MAP = {
  'A0' : 'A0.mp3',
  'C1' : 'C1.mp3',  'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', 'A1' : 'A1.mp3',
  'C2' : 'C2.mp3',  'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', 'A2' : 'A2.mp3',
  'C3' : 'C3.mp3',  'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', 'A3' : 'A3.mp3',
  'C4' : 'C4.mp3',  'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', 'A4' : 'A4.mp3',
  'C5' : 'C5.mp3',  'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', 'A5' : 'A5.mp3',
  'C6' : 'C6.mp3',  'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3', 'A6' : 'A6.mp3',
  'C7' : 'C7.mp3',  'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3', 'A7' : 'A7.mp3',
  'C8' : 'C8.mp3',
}

// ── FM SYNTH FALLBACK PARAMS ──────────────────────────────────────────────────
const FM_PARAMS = {
  harmonicity: 3.5, modulationIndex: 8,
  oscillator: { type: 'sine' },
  envelope: { attack: 0.001, decay: 0.4, sustain: 0.08, release: 1.0 },
  modulation: { type: 'square' },
  modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.1, release: 0.5 },
}
const EQ_PARAMS     = { high: 3, mid: 0, low: 6, highFrequency: 3200, lowFrequency: 250 }
const REVERB_PARAMS = { decay: 1.5, wet: 0.22 }
const MASTER_VOLUME = -4

// ── Dynamics → velocity, articulations → gate length / velocity boost ─────────
const DYNAMIC_VELOCITY = {
  ppp: 0.15, pp: 0.25, p: 0.35, mp: 0.5, mf: 0.65,
  f: 0.8, ff: 0.92, fff: 1.0, sfz: 0.95, fp: 0.85,
}
const DEFAULT_VELOCITY = 0.7 // used before any dynamic marking has appeared
// How much of the note's written duration actually sounds (the rest is silence,
// simulating detached/legato articulation) — 1.0 = full value, no gap.
const ARTICULATION_GATE = {
  staccato: 0.5, staccatissimo: 0.35, tenuto: 0.98, portato: 0.75, marcato: 0.85,
}
const ARTICULATION_VELOCITY_MULT = { accent: 1.22, marcato: 1.3 }
const FERMATA_HOLD_MULT = 1.8 // fermata notes ring longer without shifting subsequent timing

// ── Pitch helpers ─────────────────────────────────────────────────────────────
function pitchToTone(pitch) {
  if (!pitch) return null
  const acc = pitch.accidental === '#'  ? '#'
            : pitch.accidental === 'b'  ? 'b'
            : pitch.accidental === '##' ? '##'
            : pitch.accidental === 'bb' ? 'bb' : ''
  return `${pitch.step}${acc}${pitch.octave}`
}

// ── Build full event schedule from score ──────────────────────────────────────
// Returns { events, totalSecs, tempo, beatMap }
// beatMap: array of { measureIndex, beatStart (seconds), totalBeats } for seek
function buildSchedule(score, tempo) {
  const bpm        = tempo || score.tempo || 120
  const secPerBeat = 60 / bpm
  const events     = []
  const beatMap    = []   // one entry per measure: { measureIndex, startSec, beats }
  let   globalSec  = 0

  const numMeasures = Math.max(...score.parts.map(p => p.measures.length), 0)

  // Precompute each measure's global beat-start (time-signature-only pass) so
  // dynamics/hairpins — which can span measures — can be interpolated correctly
  // even for compound meters (6/8, 9/8, 12/8...).
  const measureBeatStart = []
  let cumBeat = 0
  for (let i = 0; i < numMeasures; i++) {
    measureBeatStart.push(cumBeat)
    cumBeat += measureCapacity(score.parts[0]?.measures[i]?.timeSignature)
  }
  const globalBeatOf = (measureIndex, beat) => (measureBeatStart[measureIndex] ?? 0) + beat

  // Per-part dynamics markings and hairpins, converted to global beat positions.
  const dynamicsByPart = {}
  ;(score.dynamics || []).forEach(d => {
    const level = DYNAMIC_VELOCITY[d.value]
    if (level === undefined) return
    ;(dynamicsByPart[d.partId] ??= []).push({ gb: globalBeatOf(d.measureIndex, d.beat), level })
  })
  Object.values(dynamicsByPart).forEach(arr => arr.sort((a, b) => a.gb - b.gb))

  const hairpinsByPart = {}
  ;(score.hairpins || []).forEach(h => {
    const startGb = globalBeatOf(h.startMeasure, h.startBeat)
    const endGb   = globalBeatOf(h.endMeasure, h.endBeat)
    if (endGb <= startGb) return
    ;(hairpinsByPart[h.partId] ??= []).push({ startGb, endGb, type: h.type })
  })

  // Velocity at a given global beat for a part: most recent dynamic marking,
  // with any active crescendo/decrescendo hairpin interpolated on top.
  function velocityAt(partId, gb) {
    const list = dynamicsByPart[partId] || []
    let level = DEFAULT_VELOCITY
    for (const d of list) {
      if (d.gb <= gb + 1e-6) level = d.level
      else break
    }
    const hp = (hairpinsByPart[partId] || [])
      .find(h => gb >= h.startGb - 1e-6 && gb <= h.endGb + 1e-6)
    if (hp) {
      const shift = hp.type === 'cresc' ? 0.28 : -0.28
      const endLevel = Math.max(0.12, Math.min(1, level + shift))
      const progress = (gb - hp.startGb) / (hp.endGb - hp.startGb)
      level = level + (endLevel - level) * progress
    }
    return Math.max(0.08, Math.min(1, level))
  }

  for (let mIdx = 0; mIdx < numMeasures; mIdx++) {
    const refM     = score.parts[0]?.measures[mIdx]
    const maxBeats = measureCapacity(refM?.timeSignature)

    beatMap.push({ measureIndex: mIdx, startSec: globalSec, beats: maxBeats })

    for (const part of score.parts) {
      const measure = part.measures[mIdx]
      if (!measure) continue
      const chordMap = {}
      measure.notes.filter(n => n.chordWith).forEach(n => {
        if (!chordMap[n.chordWith]) chordMap[n.chordWith] = []
        chordMap[n.chordWith].push(n)
      })
      let beatCursor = 0
      for (const note of measure.notes.filter(n => !n.chordWith)) {
        const durBeats = noteDuration(note)
        if (!note.isRest && note.pitch) {
          const companions = chordMap[note.id] || []
          const toneNotes  = [pitchToTone(note.pitch)].filter(Boolean)
          companions.forEach(c => { const t = pitchToTone(c.pitch); if (t) toneNotes.push(t) })
          if (toneNotes.length > 0) {
            const gb = globalBeatOf(mIdx, beatCursor)
            const marks = note.articulations || (note.articulation ? [note.articulation] : [])

            // Gate length: how much of the written duration actually sounds.
            let gate = 1.0
            for (const m of marks) if (ARTICULATION_GATE[m] !== undefined) gate = Math.min(gate, ARTICULATION_GATE[m])
            let holdMult = 1
            if (marks.includes('fermata')) holdMult = FERMATA_HOLD_MULT

            // Velocity: dynamics + active hairpin, boosted by accent/marcato.
            let velocity = velocityAt(part.id, gb)
            for (const m of marks) if (ARTICULATION_VELOCITY_MULT[m]) velocity *= ARTICULATION_VELOCITY_MULT[m]
            velocity = Math.max(0.05, Math.min(1, velocity))

            const fullDurSec = durBeats * secPerBeat * holdMult
            events.push({
              time:         globalSec + beatCursor * secPerBeat,
              dur:          Math.max(0.06, fullDurSec * gate * (holdMult > 1 ? 1 : 0.88)),
              notes:        toneNotes,
              velocity,
              beatPosition: globalSec / secPerBeat + beatCursor,  // absolute beat
              measureIndex: mIdx,
            })
          }
        }
        beatCursor += durBeats
      }
    }
    globalSec += maxBeats * secPerBeat
  }

  return { events, totalSecs: globalSec, tempo: bpm, beatMap }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePlayback() {
  const score           = useScoreStore(s => s.score)
  const setIsPlaying    = useScoreStore(s => s.setIsPlaying)
  const setPlaybackBeat = useScoreStore(s => s.setPlaybackBeat)

  const instrumentRef  = useRef(null)
  const fxChainRef     = useRef(null)
  const samplerReady   = useRef(false)
  const rafRef         = useRef(null)
  const isPlayingRef   = useRef(false)
  const isPausedRef    = useRef(false)
  const transportStart = useRef(0)   // Tone.now() when playback began (adjusted for seek)
  const seekOffsetRef  = useRef(0)   // seconds into score where playback started
  const totalSecsRef   = useRef(0)
  const tempoRef       = useRef(120)
  const scheduleRef    = useRef(null) // last built schedule (for seek)
  const metronomeRef   = useRef(null)
  const metronomeOnRef = useRef(false)
  const loopRef        = useRef(false)
  const userTempoRef   = useRef(null) // null = use score tempo

  // ── Effects chain ─────────────────────────────────────────────────────────
  function getEffectsChain() {
    if (fxChainRef.current) return fxChainRef.current
    const eq     = new Tone.EQ3(EQ_PARAMS)
    const reverb = new Tone.Reverb(REVERB_PARAMS)
    const vol    = new Tone.Volume(MASTER_VOLUME)
    eq.connect(reverb); reverb.connect(vol); vol.toDestination()
    fxChainRef.current = { eq, reverb, vol }
    return fxChainRef.current
  }

  // ── Sampler ───────────────────────────────────────────────────────────────
  function buildSampler() {
    const { eq } = getEffectsChain()
    return new Promise((resolve) => {
      const sampler = new Tone.Sampler({
        urls: SAMPLE_MAP, baseUrl: SAMPLE_BASE_URL,
        onload:  () => { samplerReady.current = true; resolve(sampler) },
        onerror: () => resolve(null),
      }).connect(eq)
      setTimeout(() => { if (!samplerReady.current) resolve(null) }, 15000)
    })
  }

  // ── Metronome ─────────────────────────────────────────────────────────────
  function getMetronome() {
    if (!metronomeRef.current) {
      metronomeRef.current = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
        volume: -8,
      }).toDestination()
    }
    return metronomeRef.current
  }

  // ── FM Synth fallback ─────────────────────────────────────────────────────
  function buildFMSynth() {
    const { eq } = getEffectsChain()
    const synth = new Tone.PolySynth(Tone.FMSynth, FM_PARAMS)
    synth.connect(eq); return synth
  }

  async function getInstrument() {
    if (instrumentRef.current) return instrumentRef.current
    getEffectsChain()
    const sampler = await buildSampler()
    instrumentRef.current = sampler || buildFMSynth()
    return instrumentRef.current
  }

  // ── Cursor RAF loop ───────────────────────────────────────────────────────
  function startCursorLoop() {
    const tick = () => {
      if (!isPlayingRef.current) return
      const elapsed    = Tone.now() - transportStart.current
      const totalSec   = totalSecsRef.current
      const secPerBeat = 60 / tempoRef.current

      const positionSec = seekOffsetRef.current + elapsed
      if (positionSec >= totalSec + 0.15) {
        if (loopRef.current) {
          // Loop: restart from beginning
          seekOffsetRef.current  = 0
          transportStart.current = Tone.now()
          setPlaybackBeat(0)
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        doStop(false)
        setPlaybackBeat(null)
        return
      }
      setPlaybackBeat(Math.max(0, positionSec / secPerBeat))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopCursorLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  // ── Internal stop ─────────────────────────────────────────────────────────
  function doStop(clearBeat = true) {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    isPlayingRef.current = false
    isPausedRef.current  = false
    setIsPlaying(false)
    stopCursorLoop()
    if (clearBeat) { setPlaybackBeat(null); seekOffsetRef.current = 0 }
  }

  // ── Schedule notes from a given second offset ─────────────────────────────
  async function scheduleAndPlay(startSec) {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    stopCursorLoop()

    const effectiveTempo = userTempoRef.current || score.tempo || 120
    const schedule = buildSchedule(score, effectiveTempo)
    scheduleRef.current  = schedule
    totalSecsRef.current = schedule.totalSecs
    tempoRef.current     = effectiveTempo
    seekOffsetRef.current = startSec

    if (schedule.events.length === 0) return

    const instrument = await getInstrument()
    const LEAD = 0.1

    // Only schedule events at or after startSec
    schedule.events
      .filter(ev => ev.time >= startSec - 0.001)
      .forEach(ev => {
        const relTime = ev.time - startSec + LEAD
        Tone.getTransport().schedule((audioTime) => {
          instrument.triggerAttackRelease(ev.notes, ev.dur, audioTime, ev.velocity)
        }, relTime)
      })

    // Metronome
    if (metronomeOnRef.current) {
      const met        = getMetronome()
      const secPerBeat = 60 / effectiveTempo
      const remaining  = schedule.totalSecs - startSec
      const numBeats   = Math.ceil(remaining / secPerBeat)
      const startBeat  = Math.floor(startSec / secPerBeat)
      for (let b = 0; b < numBeats; b++) {
        const t = b * secPerBeat + LEAD
        Tone.getTransport().schedule((audioTime) => {
          const isDownbeat = (startBeat + b) % 4 === 0
          met.triggerAttackRelease(isDownbeat ? 'C6' : 'G5', '32n', audioTime)
        }, t)
      }
    }

    Tone.getTransport().loop    = false  // we handle looping manually in RAF
    Tone.getTransport().bpm.value = effectiveTempo
    Tone.getTransport().start()
    isPlayingRef.current = true
    isPausedRef.current  = false
    setIsPlaying(true)

    // Record when transport actually starts (for cursor sync)
    transportStart.current = Tone.now() + LEAD
    setTimeout(() => { if (isPlayingRef.current) startCursorLoop() }, LEAD * 1000 + 20)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const play = useCallback(async () => {
    await Tone.start()
    // If paused, resume from where we stopped
    if (isPausedRef.current) {
      Tone.getTransport().start()
      isPlayingRef.current = true
      isPausedRef.current  = false
      setIsPlaying(true)
      // Adjust transport start so cursor stays in sync
      transportStart.current = Tone.now() - (seekOffsetRef.current / 1) // already set
      startCursorLoop()
      return
    }
    await scheduleAndPlay(0)
  }, [score])

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return
    // Save current position before pausing
    const elapsed = Tone.now() - transportStart.current
    seekOffsetRef.current += elapsed
    transportStart.current = Tone.now()
    Tone.getTransport().pause()
    isPlayingRef.current = false
    isPausedRef.current  = true
    setIsPlaying(false)
    stopCursorLoop()
  }, [])

  const stop = useCallback(() => {
    doStop(true)
  }, [])

  const rewind = useCallback(() => {
    doStop(true)
  }, [])

  // Seek to a specific beat position
  const seekToBeat = useCallback(async (beat) => {
    await Tone.start()
    const effectiveTempo = userTempoRef.current || score.tempo || 120
    const secPerBeat     = 60 / effectiveTempo
    const targetSec      = Math.max(0, beat * secPerBeat)
    setPlaybackBeat(beat)
    if (isPlayingRef.current || isPausedRef.current) {
      await scheduleAndPlay(targetSec)
    } else {
      seekOffsetRef.current = targetSec
      setPlaybackBeat(beat)
    }
  }, [score])

  // Seek to a specific second
  const seekToSecond = useCallback(async (sec) => {
    const effectiveTempo = userTempoRef.current || score.tempo || 120
    const beat = sec / (60 / effectiveTempo)
    await seekToBeat(beat)
  }, [score])

  // Set tempo override (null = use score tempo)
  const setTempo = useCallback((bpm) => {
    userTempoRef.current = bpm ? Math.max(20, Math.min(300, bpm)) : null
    if (isPlayingRef.current) {
      // Restart from current position with new tempo
      const elapsed = Tone.now() - transportStart.current
      const currentSec = seekOffsetRef.current + elapsed
      scheduleAndPlay(currentSec)
    }
  }, [score])

  const playFromBeat = useCallback(async (startBeat) => {
    await Tone.start()
    const effectiveTempo = userTempoRef.current || score.tempo || 120
    const startSec = (startBeat || 0) * (60 / effectiveTempo)
    await scheduleAndPlay(startSec)
  }, [score])

  const toggleMetronome = useCallback(() => {
    metronomeOnRef.current = !metronomeOnRef.current
    return metronomeOnRef.current
  }, [])

  const toggleLoop = useCallback(() => {
    loopRef.current = !loopRef.current
    return loopRef.current
  }, [])

  // Expose current position in seconds (for seek bar)
  const getCurrentSec = useCallback(() => {
    if (!isPlayingRef.current && !isPausedRef.current) return 0
    if (isPausedRef.current) return seekOffsetRef.current
    return seekOffsetRef.current + (Tone.now() - transportStart.current)
  }, [])

  const getTotalSecs  = useCallback(() => totalSecsRef.current, [])
  const getCurrentTempo = useCallback(() => userTempoRef.current || score.tempo || 120, [score])

  useEffect(() => {
    return () => {
      doStop(true)
      instrumentRef.current?.dispose(); instrumentRef.current = null
      metronomeRef.current?.dispose();  metronomeRef.current  = null
      if (fxChainRef.current) {
        fxChainRef.current.eq?.dispose()
        fxChainRef.current.reverb?.dispose()
        fxChainRef.current.vol?.dispose()
        fxChainRef.current = null
      }
    }
  }, [])

  return {
    play, pause, stop, rewind, playFromBeat,
    seekToBeat, seekToSecond, setTempo,
    toggleMetronome, toggleLoop,
    getCurrentSec, getTotalSecs, getCurrentTempo,
    isMetronomeOn: () => metronomeOnRef.current,
    isLooping:     () => loopRef.current,
    isPaused:      () => isPausedRef.current,
  }
}