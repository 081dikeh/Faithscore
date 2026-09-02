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

  // Gate/velocity for a note's articulation marks at a given global beat —
  // shared by both a fresh attack and the (rarer) chord-companion attack
  // that can still ride alongside a tied-continuation primary note below.
  function gateAndVelocity(note, gb, partId) {
    const marks = note.articulations || (note.articulation ? [note.articulation] : [])
    let gate = 1.0
    for (const m of marks) if (ARTICULATION_GATE[m] !== undefined) gate = Math.min(gate, ARTICULATION_GATE[m])
    let holdMult = 1
    if (marks.includes('fermata')) holdMult = FERMATA_HOLD_MULT
    let velocity = velocityAt(partId, gb)
    for (const m of marks) if (ARTICULATION_VELOCITY_MULT[m]) velocity *= ARTICULATION_VELOCITY_MULT[m]
    velocity = Math.max(0.05, Math.min(1, velocity))
    return { gate, holdMult, velocity }
  }

  const samePitch = (a, b) =>
    a && b &&
    a.step === b.step &&
    a.octave === b.octave &&
    (a.accidental ?? null) === (b.accidental ?? null)

  // Per-part "open tie" — the previously-scheduled event a tieStart note
  // began, kept live across notes (and measures) so a tied note can extend
  // it instead of triggering a redundant second attack. A tie means "one
  // continuous sound", not "two notes" — until this fix every tied note
  // was scheduled as its own independent triggerAttackRelease, so tied
  // pairs re-attacked audibly instead of sustaining through.
  const openTieByPart = {}

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
        const companions = chordMap[note.id] || []
        const openTie = openTieByPart[part.id]

        const isTieContinuation =
          !note.isRest && note.pitch && openTie && samePitch(note.pitch, openTie.pitch)

        if (isTieContinuation) {
          // This note is the destination of a tie from the previous note —
          // not a new attack. Extend the held event's duration to cover it
          // instead of scheduling a second triggerAttackRelease.
          openTie.event.dur += durBeats * secPerBeat
          // Chain continues only if this note ALSO starts another tie
          // onward (a tie spanning 3+ notes); otherwise this link resolves
          // the chain.
          openTieByPart[part.id] = note.tieStart
            ? { event: openTie.event, pitch: note.pitch }
            : null

          // Any chord companions stacked on this note are separate pitches
          // that were never part of the tie — they still get their own
          // fresh attack.
          const companionTones = companions.map(c => pitchToTone(c.pitch)).filter(Boolean)
          if (companionTones.length > 0) {
            const gb = globalBeatOf(mIdx, beatCursor)
            const { gate, holdMult, velocity } = gateAndVelocity(note, gb, part.id)
            const fullDurSec = durBeats * secPerBeat * holdMult
            events.push({
              time:         globalSec + beatCursor * secPerBeat,
              dur:          Math.max(0.06, fullDurSec * gate * (holdMult > 1 ? 1 : 0.88)),
              notes:        companionTones,
              velocity,
              partId:       part.id,
              beatPosition: globalSec / secPerBeat + beatCursor,
              measureIndex: mIdx,
            })
          }

          beatCursor += durBeats
          continue
        }

        if (!note.isRest && note.pitch) {
          const toneNotes = [pitchToTone(note.pitch)].filter(Boolean)
          companions.forEach(c => { const t = pitchToTone(c.pitch); if (t) toneNotes.push(t) })
          if (toneNotes.length > 0) {
            const gb = globalBeatOf(mIdx, beatCursor)
            const { gate, holdMult, velocity } = gateAndVelocity(note, gb, part.id)

            const fullDurSec = durBeats * secPerBeat * holdMult
            const scheduled = {
              time:         globalSec + beatCursor * secPerBeat,
              dur:          Math.max(0.06, fullDurSec * gate * (holdMult > 1 ? 1 : 0.88)),
              notes:        toneNotes,
              velocity,
              partId:       part.id,
              beatPosition: globalSec / secPerBeat + beatCursor,  // absolute beat
              measureIndex: mIdx,
            }
            events.push(scheduled)
            openTieByPart[part.id] = note.tieStart ? { event: scheduled, pitch: note.pitch } : null
          } else {
            openTieByPart[part.id] = null
          }
        } else {
          // A rest can't carry a tie through it.
          openTieByPart[part.id] = null
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
  // Per-part mixer — mirrors useSolfaPlayback's shape exactly, but applied
  // as a velocity scale at trigger time rather than a dedicated Gain node
  // per part, since every part here shares one instrument instance (unlike
  // Solfa's separate sampler chain per voice) — this gets the same
  // practical effect (louder/quieter/muted per part) without needing to
  // load a separate instrument per part.
  const partVolsRef    = useRef({}) // partId -> 0..100, default 100
  const partMutesRef   = useRef({}) // partId -> boolean

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
      .filter(ev => !partMutesRef.current[ev.partId])
      .forEach(ev => {
        const relTime = ev.time - startSec + LEAD
        const partScale = Math.max(0, Math.min(1, (partVolsRef.current[ev.partId] ?? 100) / 100))
        const scaledVelocity = Math.max(0, Math.min(1, ev.velocity * partScale))
        Tone.getTransport().schedule((audioTime) => {
          instrument.triggerAttackRelease(ev.notes, ev.dur, audioTime, scaledVelocity)
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

  // Per-part mixer. Volume/mute are baked into each note's velocity at
  // schedule time (see scheduleAndPlay above), not a live-automatable Gain
  // node like useSolfaPlayback's per-voice channels — so a change made
  // mid-playback needs a quick reschedule from the current position to
  // actually take effect, same as setTempo just above.
  const setPartVolume = useCallback((partId, pct) => {
    partVolsRef.current[partId] = pct
    if (isPlayingRef.current) {
      const elapsed = Tone.now() - transportStart.current
      const currentSec = seekOffsetRef.current + elapsed
      scheduleAndPlay(currentSec)
    }
  }, [score])

  const setPartMute = useCallback((partId, muted) => {
    partMutesRef.current[partId] = muted
    if (isPlayingRef.current) {
      const elapsed = Tone.now() - transportStart.current
      const currentSec = seekOffsetRef.current + elapsed
      scheduleAndPlay(currentSec)
    }
  }, [score])

  const getPartVolume = useCallback((partId) => partVolsRef.current[partId] ?? 100, [])
  const getPartMuted  = useCallback((partId) => partMutesRef.current[partId] ?? false, [])

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
    setPartVolume, setPartMute, getPartVolume, getPartMuted,
  }
}