// src/hooks/usePlayback.js
//
// Tone.js-based playback engine for ScoreAI.
// Converts the score data model into a flat event schedule,
// plays it using Tone.PolySynth, and drives a beat-cursor through the store.
//
// Usage (in App.jsx):
//   const { play, pause, stop } = usePlayback()

import { useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { useScoreStore, DURATION_BEATS, noteDuration } from '../store/scoreStore'

// ── Pitch conversion ──────────────────────────────────────────────────────────
// Convert our internal pitch object { step, octave, accidental } to a
// Tone.js frequency string like "C#4", "Bb3", "D5".
function pitchToTone(pitch) {
  if (!pitch) return null
  const acc = pitch.accidental === '#'  ? '#'
            : pitch.accidental === 'b'  ? 'b'
            : pitch.accidental === '##' ? '##'
            : pitch.accidental === 'bb' ? 'bb'
            : ''
  return `${pitch.step}${acc}${pitch.octave}`
}

// ── Beat-to-seconds conversion ────────────────────────────────────────────────
// At a given tempo (BPM), one quarter note beat = 60/tempo seconds.
// A whole note (4 beats) = 4 * (60/tempo) seconds, etc.
function beatToSeconds(beats, tempo) {
  return beats * (60 / tempo)
}

// ── Score flattener ───────────────────────────────────────────────────────────
// Walk every part, every measure, every note and produce a flat array of
// playback events:
//   { time: seconds, duration: seconds, notes: ['C4','E4','G4'], velocity: 0.8 }
// Rests produce no event (they are simply silence — no scheduling needed).
// Chord notes are grouped with their parent so they trigger simultaneously.
function buildSchedule(score) {
  const tempo    = score.tempo || 120
  const events   = []
  let   globalT  = 0  // running time offset in seconds across all measures

  // All parts share the same measure columns, so we use part[0] to drive
  // the measure-time positions, then collect notes from ALL parts at each
  // measure simultaneously.
  const numMeasures = Math.max(...score.parts.map(p => p.measures.length), 0)

  for (let mIdx = 0; mIdx < numMeasures; mIdx++) {
    // Find the beat count for this column (use first part as reference)
    const refMeasure   = score.parts[0]?.measures[mIdx]
    const maxBeats     = refMeasure?.timeSignature?.beats ?? 4
    const measureSecs  = beatToSeconds(maxBeats, tempo)

    // For each part, walk non-chord notes in this measure
    for (const part of score.parts) {
      const measure = part.measures[mIdx]
      if (!measure) continue

      // Build chord map: parentId → [chordNote, ...]
      const chordMap = {}
      measure.notes.filter(n => n.chordWith).forEach(n => {
        if (!chordMap[n.chordWith]) chordMap[n.chordWith] = []
        chordMap[n.chordWith].push(n)
      })

      let beatCursor = 0  // beat offset within this measure

      for (const note of measure.notes.filter(n => !n.chordWith)) {
        const durBeats = noteDuration(note)
        const durSecs  = beatToSeconds(durBeats, tempo)
        const startT   = globalT + beatToSeconds(beatCursor, tempo)

        if (!note.isRest && note.pitch) {
          // Collect all pitches (main note + any chord companions)
          const companions = chordMap[note.id] || []
          const toneNotes  = [pitchToTone(note.pitch)]
          companions.forEach(c => {
            const t = pitchToTone(c.pitch)
            if (t) toneNotes.push(t)
          })

          events.push({
            time:     startT,
            duration: durSecs * 0.92,   // 8% shorter for natural articulation
            notes:    toneNotes,
            velocity: 0.75,
            // Store beat info for the cursor
            beatTime: startT,           // absolute seconds from start
            measureIndex: mIdx,
            beatInMeasure: beatCursor,
          })
        }

        beatCursor += durBeats
      }
    }

    globalT += measureSecs
  }

  // Total score duration in seconds
  const totalSecs = globalT

  return { events, totalSecs, tempo }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePlayback() {
  const score        = useScoreStore(s => s.score)
  const setIsPlaying = useScoreStore(s => s.setIsPlaying)
  const setPlaybackBeat = useScoreStore(s => s.setPlaybackBeat)

  // Tone.js objects stored in refs (not state) so they don't cause re-renders
  const synthRef     = useRef(null)
  const partRef      = useRef(null)    // Tone.Part — the event sequencer
  const cursorRef    = useRef(null)    // requestAnimationFrame id
  const startWallRef = useRef(null)    // wall-clock time when play began
  const startOffRef  = useRef(0)       // seconds offset (for resume after pause)
  const scheduleRef  = useRef(null)    // cached { events, totalSecs }
  const isPlayingRef = useRef(false)

  // ── Synth initialisation ────────────────────────────────────────────────────
  // Create a polyphonic synth the first time it's needed.
  // PolySynth wraps multiple Synth voices so chords work correctly.
  function getSynth() {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },  // warm, piano-like tone
        envelope: {
          attack:  0.005,
          decay:   0.1,
          sustain: 0.6,
          release: 0.8,
        },
      }).toDestination()
      synthRef.current.set({ volume: -6 })  // -6dB to avoid clipping
    }
    return synthRef.current
  }

  // ── Cursor animation ────────────────────────────────────────────────────────
  // Uses requestAnimationFrame to update the playback beat position ~60fps.
  // The "beat" value is a fractional beat number from the start of the score.
  function startCursor(offsetSecs, tempo) {
    const tick = () => {
      if (!isPlayingRef.current) return
      const elapsed   = Tone.now() - startWallRef.current + offsetSecs
      const beatPos   = elapsed / (60 / tempo)   // convert seconds → beats
      setPlaybackBeat(Math.max(0, beatPos))
      cursorRef.current = requestAnimationFrame(tick)
    }
    cursorRef.current = requestAnimationFrame(tick)
  }

  function stopCursor() {
    if (cursorRef.current) {
      cancelAnimationFrame(cursorRef.current)
      cursorRef.current = null
    }
  }

  // ── Play ────────────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    // Tone.js requires user gesture to start AudioContext
    await Tone.start()

    const { events, totalSecs, tempo } = buildSchedule(score)
    scheduleRef.current = { totalSecs, tempo }

    // Stop any existing playback cleanly
    if (partRef.current) {
      partRef.current.stop()
      partRef.current.dispose()
      partRef.current = null
    }
    Tone.getTransport().stop()
    Tone.getTransport().cancel()

    const synth = getSynth()
    const offset = startOffRef.current  // seconds to start from (0 = beginning)

    // Build a Tone.Part from all note events
    // Each event fires at its `time` and triggers the synth
    const part = new Tone.Part((time, ev) => {
      synth.triggerAttackRelease(ev.notes, ev.duration, time, ev.velocity)
    }, events.map(ev => [ev.time, ev]))

    part.start(0)
    partRef.current = part

    // Set tempo and start transport from offset position
    Tone.getTransport().bpm.value = tempo
    Tone.getTransport().start('+0.05', offset)

    // Track wall-clock start for cursor
    startWallRef.current = Tone.now() + 0.05 - offset
    isPlayingRef.current = true
    setIsPlaying(true)
    startCursor(offset, tempo)

    // Auto-stop when score ends
    const remaining = totalSecs - offset
    if (remaining > 0) {
      setTimeout(() => {
        if (isPlayingRef.current) stop()
      }, remaining * 1000 + 200)  // +200ms buffer
    }
  }, [score])

  // ── Pause ───────────────────────────────────────────────────────────────────
  const pause = useCallback(() => {
    if (!isPlayingRef.current) return
    // Save current position so resume starts from here
    const elapsed = Tone.now() - startWallRef.current + startOffRef.current
    startOffRef.current = Math.max(0, elapsed)
    Tone.getTransport().pause()
    isPlayingRef.current = false
    setIsPlaying(false)
    stopCursor()
  }, [])

  // ── Stop ────────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    if (partRef.current) {
      partRef.current.stop()
      partRef.current.dispose()
      partRef.current = null
    }
    isPlayingRef.current = false
    startOffRef.current  = 0  // reset to beginning
    setIsPlaying(false)
    setPlaybackBeat(null)     // clear cursor
    stopCursor()
  }, [])

  // ── Rewind ──────────────────────────────────────────────────────────────────
  const rewind = useCallback(() => {
    stop()
    setPlaybackBeat(0)
  }, [stop])

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stop()
      if (synthRef.current) {
        synthRef.current.dispose()
        synthRef.current = null
      }
    }
  }, [])

  return { play, pause, stop, rewind }
}
