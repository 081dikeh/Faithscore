// src/hooks/usePlayback.js
//
// ════════════════════════════════════════════════════════════════════════════
//  SOUND GUIDE — how to adjust the audio in this file
// ════════════════════════════════════════════════════════════════════════════
//
//  ScoreAI uses TWO sound engines, with automatic fallback:
//
//  1. SAMPLER (best quality) — loads real recorded piano samples from a CDN.
//     Sounds like an actual piano. Requires internet on first load.
//     → To swap the instrument, change SAMPLE_BASE_URL + SAMPLE_MAP below.
//     → Free sample libraries: https://gleitz.github.io/midi-js-soundfonts/
//
//  2. FM SYNTH (fallback / offline) — a fully synthetic piano built from
//     Tone.js oscillators. Tweakable in the SYNTH SOUND PARAMETERS section.
//
//  QUICK TUNING REFERENCE (FM Synth):
//  ┌──────────────────────────────────────────────────────────────────────┐
//  │ harmonicity    — ratio of carrier : modulator frequency              │
//  │                  1 = unison, 2 = octave up, 0.5 = octave down       │
//  │                  Try: 3, 5, 7 for brighter tones                    │
//  │                                                                      │
//  │ modulationIndex — depth of FM modulation = "brightness" / "texture" │
//  │                  0 = pure sine, 2-5 = piano-like, 10+ = bell/organ  │
//  │                                                                      │
//  │ envelope.attack  — how fast the note starts (seconds)               │
//  │                  Piano: 0.001–0.005  | Strings: 0.2–0.5             │
//  │ envelope.decay   — how fast volume drops after attack peak           │
//  │                  Piano: 0.3–0.8      | Organ: 0                     │
//  │ envelope.sustain — volume level held while key is pressed (0–1)     │
//  │                  Piano: 0.05–0.15    | Organ: 1.0                   │
//  │ envelope.release — fade time after key is released                  │
//  │                  Piano: 0.5–1.2      | Pad: 2–4                     │
//  │                                                                      │
//  │ modEnvelope      — same params but controls the FM brightness over  │
//  │                  time. Short decay = bright attack, dark sustain     │
//  │                                                                      │
//  │ volume           — output level in dB. -6 is safe, -12 is quieter  │
//  │ EQ treble        — positive = brighter. Try +3 to +8 for presence   │
//  │ EQ bass          — positive = more low end. -4 to -8 cleans bass    │
//  │ reverb wet       — 0 = dry, 1 = fully wet. 0.2–0.35 = concert hall │
//  │ reverb decay     — room size in seconds. 1.2 = small, 3+ = large   │
//  └──────────────────────────────────────────────────────────────────────┘
//
//  TO SWITCH TO A DIFFERENT BUILT-IN TONE.JS SYNTH:
//    Replace `new Tone.FMSynth(...)` with any of:
//    • Tone.AMSynth    — amplitude modulation, warmer/softer
//    • Tone.DuoSynth   — two detuned oscillators, richer chords
//    • Tone.PluckSynth — physical model of a plucked string (great for solo)
//    • Tone.MetalSynth — bell / metallic tones
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useScoreStore, noteDuration } from '../store/scoreStore'

// ── SAMPLER CONFIG ────────────────────────────────────────────────────────────
// Salamander Grand Piano samples — hosted on Tone.js's official CDN.
// These are the exact samples used in Tone.js's own piano demos.
// The Sampler pitch-shifts between recorded notes to cover the full keyboard.
// To use a different instrument, change baseUrl to any soundfont folder from:
//   https://gleitz.github.io/midi-js-soundfonts/MusyngKite/
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

// ── SYNTH SOUND PARAMETERS ────────────────────────────────────────────────────
// Used when Sampler fails (offline / CDN error). Tweak freely.
const FM_PARAMS = {
  harmonicity:     3.5,       // carrier:modulator ratio — 3.5 gives piano-like bell tone
  modulationIndex: 8,         // FM depth — higher = brighter/more metallic attack
  oscillator:      { type: 'sine' },
  envelope: {
    attack:  0.001,           // near-instant attack (hammer strike)
    decay:   0.4,             // fast decay — piano notes bloom then fade quickly
    sustain: 0.08,            // very low sustain — piano is not a sustained instrument
    release: 1.0,             // gentle release tail
  },
  modulation:      { type: 'square' },
  modulationEnvelope: {
    attack:  0.002,           // modulator attacks slightly after carrier
    decay:   0.2,             // modulator decays fast → brightness fades quickly
    sustain: 0.1,
    release: 0.5,
  },
}

// ── EFFECTS CHAIN PARAMETERS ──────────────────────────────────────────────────
// Shared by both Sampler and FM synth.
const EQ_PARAMS    = { high: 3, mid: 0, low: 6, highFrequency: 3200, lowFrequency: 250 }
const REVERB_PARAMS = { decay: 1.5, wet: 0.22 }   // wet: 0=dry, 1=full reverb
const MASTER_VOLUME = -4   // dB — raise if too quiet, lower if clipping

// ── Pitch conversion ──────────────────────────────────────────────────────────
function pitchToTone(pitch) {
  if (!pitch) return null
  const acc = pitch.accidental === '#'  ? '#'
            : pitch.accidental === 'b'  ? 'b'
            : pitch.accidental === '##' ? '##'
            : pitch.accidental === 'bb' ? 'bb'
            : ''
  return `${pitch.step}${acc}${pitch.octave}`
}

// ── Score → flat event list ───────────────────────────────────────────────────
function buildSchedule(score) {
  const tempo      = score.tempo || 120
  const secPerBeat = 60 / tempo
  const events     = []
  let   globalSec  = 0

  const numMeasures = Math.max(...score.parts.map(p => p.measures.length), 0)

  for (let mIdx = 0; mIdx < numMeasures; mIdx++) {
    const refM     = score.parts[0]?.measures[mIdx]
    const maxBeats = refM?.timeSignature?.beats ?? 4

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
          const toneNotes  = [pitchToTone(note.pitch)]
          companions.forEach(c => { const t = pitchToTone(c.pitch); if (t) toneNotes.push(t) })
          events.push({
            time:  globalSec + beatCursor * secPerBeat,
            dur:   Math.max(0.08, durBeats * secPerBeat * 0.88),
            notes: toneNotes,
          })
        }
        beatCursor += durBeats
      }
    }
    globalSec += maxBeats * secPerBeat
  }

  return { events, totalSecs: globalSec, tempo }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePlayback() {
  const score           = useScoreStore(s => s.score)
  const setIsPlaying    = useScoreStore(s => s.setIsPlaying)
  const setPlaybackBeat = useScoreStore(s => s.setPlaybackBeat)

  const instrumentRef  = useRef(null)   // Sampler or PolySynth(FMSynth)
  const fxChainRef     = useRef(null)   // { eq, reverb, vol }
  const samplerReady   = useRef(false)
  const rafRef         = useRef(null)
  const isPlayingRef   = useRef(false)
  const transportStart = useRef(0)
  const totalSecsRef   = useRef(0)
  const tempoRef       = useRef(120)

  // ── Build effects chain (EQ → Reverb → Master Volume → Destination) ───────
  function getEffectsChain() {
    if (fxChainRef.current) return fxChainRef.current

    const eq     = new Tone.EQ3(EQ_PARAMS)
    const reverb = new Tone.Reverb(REVERB_PARAMS)
    const vol    = new Tone.Volume(MASTER_VOLUME)

    // Connect: instrument → eq → reverb → vol → speakers
    eq.connect(reverb)
    reverb.connect(vol)
    vol.toDestination()

    fxChainRef.current = { eq, reverb, vol }
    return fxChainRef.current
  }

  // ── Build Sampler (real piano samples) ────────────────────────────────────
  function buildSampler() {
    const { eq } = getEffectsChain()
    return new Promise((resolve) => {
      const sampler = new Tone.Sampler({
        urls:    SAMPLE_MAP,
        baseUrl: SAMPLE_BASE_URL,
        onload:  () => { samplerReady.current = true; resolve(sampler) },
        onerror: () => { resolve(null) },   // fall through to FM synth
      }).connect(eq)
      // Timeout fallback — if samples don't load in 6s, use FM
      setTimeout(() => { if (!samplerReady.current) resolve(null) }, 15000)
    })
  }

  // ── Build FM Synth (offline fallback) ─────────────────────────────────────
  function buildFMSynth() {
    const { eq } = getEffectsChain()
    // PolySynth wraps FMSynth for polyphony (chords)
    const synth = new Tone.PolySynth(Tone.FMSynth, FM_PARAMS)
    synth.connect(eq)
    return synth
  }

  // ── Initialise instrument (called once on first play) ─────────────────────
  async function getInstrument() {
    if (instrumentRef.current) return instrumentRef.current
    getEffectsChain()   // ensure chain exists

    // Try Sampler first
    const sampler = await buildSampler()
    if (sampler) {
      instrumentRef.current = sampler
    } else {
      // Fall back to FM synth
      instrumentRef.current = buildFMSynth()
    }
    return instrumentRef.current
  }

  // ── Cursor RAF loop ────────────────────────────────────────────────────────
  function startCursorLoop() {
    const secPerBeat = 60 / tempoRef.current
    const tick = () => {
      if (!isPlayingRef.current) return
      const elapsed = Tone.now() - transportStart.current
      if (elapsed >= totalSecsRef.current + 0.15) {
        doStop(false); return
      }
      setPlaybackBeat(Math.max(0, elapsed / secPerBeat))
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
    setIsPlaying(false)
    stopCursorLoop()
    if (clearBeat) setPlaybackBeat(null)
  }

  // ── play ──────────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    await Tone.start()
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    stopCursorLoop()

    const { events, totalSecs, tempo } = buildSchedule(score)
    totalSecsRef.current = totalSecs
    tempoRef.current     = tempo
    if (events.length === 0) return

    const instrument = await getInstrument()
    const LEAD = 0.1

    events.forEach(ev => {
      Tone.getTransport().schedule((audioTime) => {
        // Bass notes (octave ≤ 3) get boosted velocity so they
        // cut through clearly alongside the treble voice.
        // Velocity range: 0 (silent) → 1 (loudest). Piano is ~0.75, bass ~0.95.
        const isBass = ev.notes.some(n => {
          const oct = parseInt(n.replace(/[^0-9]/g, ''), 10)
          return oct <= 3
        })
        const velocity = isBass ? 0.95 : 0.78
        instrument.triggerAttackRelease(ev.notes, ev.dur, audioTime, velocity)
      }, ev.time + LEAD)
    })

    Tone.getTransport().schedule((audioTime) => {
      transportStart.current = audioTime
    }, LEAD)

    Tone.getTransport().bpm.value = tempo
    Tone.getTransport().start()
    isPlayingRef.current = true
    setIsPlaying(true)

    setTimeout(() => {
      if (isPlayingRef.current) startCursorLoop()
    }, LEAD * 1000 + 20)

  }, [score])

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return
    Tone.getTransport().pause()
    isPlayingRef.current = false
    setIsPlaying(false)
    stopCursorLoop()
  }, [])

  const stop  = useCallback(() => { doStop(true) }, [])
  const rewind = useCallback(() => { doStop(true) }, [])

  useEffect(() => {
    return () => {
      doStop(true)
      instrumentRef.current?.dispose()
      instrumentRef.current = null
      if (fxChainRef.current) {
        fxChainRef.current.eq?.dispose()
        fxChainRef.current.reverb?.dispose()
        fxChainRef.current.vol?.dispose()
        fxChainRef.current = null
      }
    }
  }, [])

  return { play, pause, stop, rewind }
}