// src/hooks/useSolfaPlayback.js
// FaithScore — Solfa Playback
//
// FIXES:
//   1. SUSTAIN: when a note is followed by one or more sustain events,
//      their durations are merged into the note's total playback duration.
//      So "d – –" (note + 2 sustains in 4/4) plays for 3 quarter-units.
//
//   2. PER-PART VOLUME: each voice part gets its own Tone.Volume node.
//      Call setPartVolume(partId, db) to adjust (-60 to 0 dB).
//      Call setPartMute(partId, true/false) to mute a part.

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useSolfaStore, solfaToMidi, migrateMeasure } from '../store/solfaStore'

// ── SAMPLER ───────────────────────────────────────────────────────────────────
const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'
const SAMPLE_MAP = {
  'A0':'A0.mp3',
  'C1':'C1.mp3','D#1':'Ds1.mp3','F#1':'Fs1.mp3','A1':'A1.mp3',
  'C2':'C2.mp3','D#2':'Ds2.mp3','F#2':'Fs2.mp3','A2':'A2.mp3',
  'C3':'C3.mp3','D#3':'Ds3.mp3','F#3':'Fs3.mp3','A3':'A3.mp3',
  'C4':'C4.mp3','D#4':'Ds4.mp3','F#4':'Fs4.mp3','A4':'A4.mp3',
  'C5':'C5.mp3','D#5':'Ds5.mp3','F#5':'Fs5.mp3','A5':'A5.mp3',
  'C6':'C6.mp3','D#6':'Ds6.mp3','F#6':'Fs6.mp3','A6':'A6.mp3',
  'C7':'C7.mp3','D#7':'Ds7.mp3','F#7':'Fs7.mp3','A7':'A7.mp3',
  'C8':'C8.mp3',
}

const FM_PARAMS = {
  harmonicity:3.5, modulationIndex:8,
  oscillator:{type:'sine'},
  envelope:{attack:0.001,decay:0.4,sustain:0.08,release:1.0},
  modulation:{type:'square'},
  modulationEnvelope:{attack:0.002,decay:0.2,sustain:0.1,release:0.5},
}
const REVERB_PARAMS = {decay:1.5, wet:0.18}
const MASTER_VOLUME = -4

// ── HELPERS ───────────────────────────────────────────────────────────────────
function midiToToneName(midi) {
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const c     = Math.max(21, Math.min(108, midi))
  return `${NAMES[c % 12]}${Math.floor(c / 12) - 1}`
}

// ── BUILD SCHEDULE ────────────────────────────────────────────────────────────
// Returns { events, totalSecs, tempo, beatMap }
// Each event: { time, dur, note, partId, measureIndex }
//
// SUSTAIN HANDLING:
//   We walk through each beat's events linearly.
//   When we find a 'note', we look ahead to count consecutive 'sustain' events
//   immediately after it and add their durations to the note's total duration.
//   This makes "d – –" play for 3 quarter-units instead of 1.
function buildSchedule(score, tempo, partVolumes, partMutes) {
  const bpm         = tempo || score.tempo || 80
  const secPerBeat  = 60 / bpm
  const secPerQUnit = secPerBeat / 4
  const key         = score.key || 'C'
  const events      = []
  const beatMap     = []
  let   globalSec   = 0

  const parts = score.parts || []
  const numM  = Math.max(...parts.map(p => p.measures.length), 0)

  for (let mIdx = 0; mIdx < numM; mIdx++) {
    const refMeasure = migrateMeasure(parts[0]?.measures[mIdx])
    const numBeats   = refMeasure?.timeSignature?.beats || 4

    beatMap.push({ measureIndex: mIdx, startSec: globalSec, beats: numBeats })

    for (const part of parts) {
      // Skip muted parts
      if (partMutes?.[part.id]) continue

      const measure = migrateMeasure(part.measures[mIdx])
      if (!measure?.beats) continue

      // Flatten all events across all beats into a single timeline for this measure,
      // each with an absolute qUnit offset from measure start.
      const flatEvents = []
      let qAbs = 0
      for (const beat of measure.beats) {
        for (const ev of beat.events || []) {
          flatEvents.push({ ...ev, qAbs })
          qAbs += ev.duration
        }
      }

      // Walk the flat events, merging sustains into the preceding note
      let i = 0
      while (i < flatEvents.length) {
        const ev = flatEvents[i]

        if (ev.type === 'note' && ev.syllable) {
          // Accumulate this note's duration + any consecutive sustains after it
          let totalQDur = ev.duration
          let j = i + 1
          while (j < flatEvents.length && flatEvents[j].type === 'sustain') {
            totalQDur += flatEvents[j].duration
            j++
          }

          const startSec = globalSec + ev.qAbs * secPerQUnit
          const durSec   = totalQDur * secPerQUnit

          const midi     = solfaToMidi(ev.syllable, ev.octave || 0, key)
          const noteName = midiToToneName(midi)

          events.push({
            time:         startSec,
            dur:          Math.max(0.08, durSec - 0.04),  // tiny gap between notes
            note:         noteName,
            partId:       part.id,
            measureIndex: mIdx,
          })

          i = j  // skip past the sustains we already consumed
        } else {
          i++   // rest or orphaned sustain — skip
        }
      }
    }

    globalSec += numBeats * secPerBeat
  }

  return { events, totalSecs: globalSec, tempo: bpm, beatMap }
}

// ── HOOK ──────────────────────────────────────────────────────────────────────
export function useSolfaPlayback() {
  const score = useSolfaStore(s => s.score)

  // ── Audio nodes ────────────────────────────────────────────────────────────
  const masterReverbRef  = useRef(null)
  const masterVolRef     = useRef(null)
  const samplerRef       = useRef(null)    // shared sampler for all parts
  const samplerReadyRef  = useRef(false)
  // Per-part volume nodes: { [partId]: Tone.Volume }
  const partVolNodesRef  = useRef({})
  // Per-part volume levels (dB) and mute state — kept in ref for scheduling
  const partVolumesRef   = useRef({})   // { [partId]: number (dB, 0=full) }
  const partMutesRef     = useRef({})   // { [partId]: boolean }

  // ── Transport refs ─────────────────────────────────────────────────────────
  const rafRef          = useRef(null)
  const isPlayingRef    = useRef(false)
  const isPausedRef     = useRef(false)
  const transportStart  = useRef(0)
  const seekOffsetRef   = useRef(0)
  const totalSecsRef    = useRef(0)
  const tempoRef        = useRef(80)
  const metronomeRef    = useRef(null)
  const metronomeOnRef  = useRef(false)
  const loopRef         = useRef(false)
  const userTempoRef    = useRef(null)

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const onPlayingChange = useRef(null)
  const onBeatChange    = useRef(null)

  function notifyPlaying(v) { onPlayingChange.current?.(v) }
  function notifyBeat(b)    { onBeatChange.current?.(b) }

  // ── Master effects chain ──────────────────────────────────────────────────
  function getMasterChain() {
    if (!masterReverbRef.current) {
      masterReverbRef.current = new Tone.Reverb(REVERB_PARAMS)
      masterVolRef.current    = new Tone.Volume(MASTER_VOLUME)
      masterReverbRef.current.connect(masterVolRef.current)
      masterVolRef.current.toDestination()
    }
    return { reverb: masterReverbRef.current, vol: masterVolRef.current }
  }

  // ── Per-part volume node ──────────────────────────────────────────────────
  // Each part's notes go through its own Volume node → master reverb
  function getPartVolNode(partId) {
    if (!partVolNodesRef.current[partId]) {
      const { reverb } = getMasterChain()
      const node = new Tone.Volume(partVolumesRef.current[partId] ?? 0)
      node.connect(reverb)
      partVolNodesRef.current[partId] = node
    }
    return partVolNodesRef.current[partId]
  }

  // ── Sampler ───────────────────────────────────────────────────────────────
  // Single shared sampler; we route to per-part volumes via a custom trigger
  function buildSampler() {
    const { reverb } = getMasterChain()
    return new Promise(resolve => {
      // We connect sampler to destination; per-note volume is applied via velocity
      // Per-part routing: we create one PolySynth per part instead of one sampler
      // This gives us real per-part volume control.
      resolve(null)  // signal to use per-part synths
    })
  }

  // Per-part PolySynth (FM, good enough for solfa preview)
  function getPartSynth(partId) {
    if (!samplerRef.current) samplerRef.current = {}
    if (!samplerRef.current[partId]) {
      const volNode = getPartVolNode(partId)
      const synth   = new Tone.PolySynth(Tone.FMSynth, FM_PARAMS)
      synth.connect(volNode)
      samplerRef.current[partId] = synth
    }
    return samplerRef.current[partId]
  }

  // Try to load the real piano sampler for the first/main part
  // and use FM synth for the rest (cost-effective)
  const pianoRef = useRef(null)
  const pianoReadyRef = useRef(false)

  async function getPiano(partId) {
    // Use real piano for all parts if loaded, else FM synth
    if (pianoReadyRef.current && pianoRef.current) {
      return pianoRef.current
    }
    if (!pianoRef.current) {
      const volNode = getPartVolNode(partId)
      pianoRef.current = new Tone.Sampler({
        urls: SAMPLE_MAP, baseUrl: SAMPLE_BASE_URL,
        onload: () => { pianoReadyRef.current = true },
        onerror: () => { pianoRef.current = null },
      })
      // Connect piano to master reverb (per-part volume applied via velocity adjustment)
      pianoRef.current.connect(getMasterChain().reverb)
      // Wait briefly for load
      await new Promise(r => setTimeout(r, 500))
    }
    if (pianoReadyRef.current) return pianoRef.current
    return getPartSynth(partId)  // fallback to FM
  }

  // ── Metronome ─────────────────────────────────────────────────────────────
  function getMetronome() {
    if (!metronomeRef.current) {
      metronomeRef.current = new Tone.Synth({
        oscillator:{type:'triangle'},
        envelope:{attack:0.001,decay:0.06,sustain:0,release:0.06},
        volume:-10,
      }).toDestination()
    }
    return metronomeRef.current
  }

  // ── Cursor RAF ────────────────────────────────────────────────────────────
  function startCursorLoop() {
    const tick = () => {
      if (!isPlayingRef.current) return
      const elapsed     = Tone.now() - transportStart.current
      const positionSec = seekOffsetRef.current + elapsed
      const totalSec    = totalSecsRef.current
      if (positionSec >= totalSec + 0.15) {
        if (loopRef.current) {
          seekOffsetRef.current  = 0
          transportStart.current = Tone.now()
          notifyBeat(0)
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        doStop(false)
        notifyBeat(null)
        return
      }
      notifyBeat(Math.max(0, positionSec / (60 / tempoRef.current)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopCursorLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  // ── Stop ──────────────────────────────────────────────────────────────────
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

    const effectiveTempo = userTempoRef.current || score.tempo || 80
    const schedule       = buildSchedule(
      score, effectiveTempo,
      partVolumesRef.current, partMutesRef.current
    )
    totalSecsRef.current  = schedule.totalSecs
    tempoRef.current      = effectiveTempo
    seekOffsetRef.current = startSec

    if (schedule.events.length === 0) return

    const LEAD = 0.12

    // Group events by partId for routing
    const eventsByPart = {}
    for (const ev of schedule.events) {
      if (!eventsByPart[ev.partId]) eventsByPart[ev.partId] = []
      eventsByPart[ev.partId].push(ev)
    }

    // Schedule each part's events through its own synth/volume chain
    for (const [partId, evts] of Object.entries(eventsByPart)) {
      const instrument = await getPiano(partId)
      const dbVol      = partVolumesRef.current[partId] ?? 0
      // Convert dB to velocity (0-1 range, clamped)
      const velocity   = Math.max(0.05, Math.min(1, Math.pow(10, dbVol / 40)))

      evts
        .filter(ev => ev.time >= startSec - 0.001)
        .forEach(ev => {
          const relTime = ev.time - startSec + LEAD
          Tone.getTransport().schedule((audioTime) => {
            try {
              instrument.triggerAttackRelease(ev.note, ev.dur, audioTime, velocity)
            } catch(e) { /* ignore note out of range */ }
          }, relTime)
        })
    }

    // Metronome
    if (metronomeOnRef.current) {
      const met        = getMetronome()
      const secPerBeat = 60 / effectiveTempo
      const numBeats   = Math.ceil((schedule.totalSecs - startSec) / secPerBeat)
      const startBeat  = Math.floor(startSec / secPerBeat)
      const beatsInBar = score.timeSignature?.beats || 4
      for (let b = 0; b < numBeats; b++) {
        const t = b * secPerBeat + LEAD
        Tone.getTransport().schedule((audioTime) => {
          const isDown = (startBeat + b) % beatsInBar === 0
          met.triggerAttackRelease(isDown ? 'C6' : 'G5', '32n', audioTime)
        }, t)
      }
    }

    Tone.getTransport().bpm.value = effectiveTempo
    Tone.getTransport().loop      = false
    Tone.getTransport().start()
    isPlayingRef.current  = true
    isPausedRef.current   = false
    notifyPlaying(true)
    transportStart.current = Tone.now() + LEAD
    setTimeout(() => { if (isPlayingRef.current) startCursorLoop() }, LEAD * 1000 + 20)
  }

  // ── Public API ────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    await Tone.start()
    if (isPausedRef.current) {
      Tone.getTransport().start()
      isPlayingRef.current = true
      isPausedRef.current  = false
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

  const stop = useCallback(() => { doStop(true) }, [])

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
      const currentSec = seekOffsetRef.current + (Tone.now() - transportStart.current)
      scheduleAndPlay(currentSec)
    }
  }, [score])

  // ── Per-part volume control ───────────────────────────────────────────────
  // volume: -60 (silent) to 0 (full). Default 0.
  const setPartVolume = useCallback((partId, db) => {
    const clamped = Math.max(-60, Math.min(0, db))
    partVolumesRef.current[partId] = clamped
    // Apply live to existing node if it exists
    if (partVolNodesRef.current[partId]) {
      partVolNodesRef.current[partId].volume.value = clamped
    }
    // If using piano (shared), we apply via velocity on next play
  }, [])

  const setPartMute = useCallback((partId, muted) => {
    partMutesRef.current[partId] = muted
    // Silence the part immediately if playing
    if (partVolNodesRef.current[partId]) {
      partVolNodesRef.current[partId].mute = muted
    }
  }, [])

  const getPartVolume = useCallback((partId) => {
    return partVolumesRef.current[partId] ?? 0
  }, [])

  const getPartMuted = useCallback((partId) => {
    return partMutesRef.current[partId] ?? false
  }, [])

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

  const onPlaying = useCallback((cb) => { onPlayingChange.current = cb }, [])
  const onBeat    = useCallback((cb) => { onBeatChange.current = cb }, [])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      doStop(true)
      pianoRef.current?.dispose()
      pianoRef.current = null
      pianoReadyRef.current = false
      if (samplerRef.current) {
        Object.values(samplerRef.current).forEach(s => s?.dispose())
        samplerRef.current = {}
      }
      Object.values(partVolNodesRef.current).forEach(n => n?.dispose())
      partVolNodesRef.current = {}
      metronomeRef.current?.dispose(); metronomeRef.current = null
      masterReverbRef.current?.dispose(); masterReverbRef.current = null
      masterVolRef.current?.dispose();   masterVolRef.current = null
    }
  }, [])

  return {
    play, pause, stop, seekToBeat, setTempo,
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