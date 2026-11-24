// Instrument catalog + the SoundFont render core (runs the real sound bank in Node).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { INSTRUMENTS, INSTRUMENT_BY_ID, getInstrument, guessInstrumentId, drumKeyFor } from '../audio/instruments.js'
import { LOUDNESS_TRIMS } from '../audio/loudnessTrims.js'

const WANTED = ['Piano','Grand Piano','Upright Piano','Harpsichord','Clavichord','Organ — Pipe','Organ — Electronic','Electric Piano','Electric Organ','Synthesizer','Accordion','Melodica','Piccolo','Flute','Oboe','Clarinet in B♭','Bass Clarinet in B♭','Soprano Saxophone','Alto Saxophone','Tenor Saxophone','Baritone Saxophone','Bassoon','Contrabassoon','Harmonica','Concertina','French Horn','Trumpet in B♭','Cornet','Flugelhorn','Tenor Trombone','Bass Trombone','Euphonium','Baritone Horn','Tuba','Wagner Tuba','Timpani','Crotales','Glockenspiel','Xylophone','Vibraphone','Marimba','Celesta','Tubular Bells','Cimbalom','Classical Guitar','Acoustic Guitar','Electric Guitar','12-String Guitar','Bass Guitar','Ukulele','Banjo','Mandolin','Lute','Harp','Balalaika','Sitar','Violin','Viola','Cello','Double Bass','Violin I','Violin II','Viola da Gamba','Hardanger Fiddle','Snare Drum','Bass Drum','Tenor Drum','Bongo Drums','Congas','Timbales','Cymbals','Hi-Hat','Crash Cymbal','Ride Cymbal','Tambourine','Triangle','Woodblock','Cowbell','Castanets','Claves','Hand Claps','Stomp','Finger Snaps','Soprano Voice','Mezzo-Soprano Voice','Alto/Contralto Voice','Tenor Voice','Baritone Voice','Bass Voice','Unspecified Voice','SATB Choir','SSA Choir','TTB Choir','Backing Vocals']

test('catalog has every requested instrument, with valid sounds', () => {
  const names = new Set(INSTRUMENTS.map(i => i.name))
  assert.deepEqual(WANTED.filter(n => !names.has(n)), [])
  assert.equal(new Set(INSTRUMENTS.map(i => i.id)).size, INSTRUMENTS.length) // unique ids
  for (const i of INSTRUMENTS) {
    if (i.unpitched) assert.ok(i.drum >= 27 && i.drum <= 87, `${i.id} drum key`)
    else assert.ok(Number.isInteger(i.program) && i.program >= 0 && i.program <= 127, `${i.id} program`)
    assert.equal(typeof LOUDNESS_TRIMS[i.id], 'number', `${i.id} has a loudness trim`)
  }
})

test('every voice and unpitched instrument is distinguishable', () => {
  assert.equal(getInstrument('soprano-voice').voice, true)
  assert.equal(getInstrument('violin').group, 'Bowed strings')
  assert.equal(getInstrument('snare-drum').unpitched, true)
  assert.equal(drumKeyFor(INSTRUMENT_BY_ID['bongo-drums'], 55), 61) // low bongo
  assert.equal(drumKeyFor(INSTRUMENT_BY_ID['bongo-drums'], 65), 60) // high bongo
  assert.equal(drumKeyFor(INSTRUMENT_BY_ID['snare-drum'], 40), 38)
})

test('old / unknown instrument ids play as piano; names are matched sensibly', () => {
  assert.equal(getInstrument('Piano').id, 'piano')
  assert.equal(getInstrument('something-odd').id, 'piano')
  assert.equal(guessInstrumentId('Soprano', 4), 'soprano-voice')
  assert.equal(guessInstrumentId('Alto', 4), 'alto-voice')
  assert.equal(guessInstrumentId('Tenor', 4), 'tenor-voice')
  assert.equal(guessInstrumentId('Bass', 4), 'bass-voice')
  assert.equal(guessInstrumentId('Bass', 2), 'piano')       // left hand of a piano score
  assert.equal(guessInstrumentId('Treble', 2), 'piano')
  assert.equal(guessInstrumentId('Violin II', 4), 'violin-2')
  assert.equal(guessInstrumentId('Tenor Saxophone', 1), 'tenor-sax')
})

const SF = new URL('../../public/soundfonts/FluidR3Mono_GM.sf3', import.meta.url)
const haveSF = fs.existsSync(SF)

test('real sound bank: different instruments render different, non-silent audio', { skip: !haveSF }, async () => {
  const { parseSoundBank, renderWindow } = await import('../audio/renderCore.js')
  const buf = fs.readFileSync(SF)
  const bank = parseSoundBank(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const phrase = [60, 64, 67, 72].map((m, i) => ({ t: i * 0.5, d: 0.45, midi: m, vel: 90 }))
  const mk = (id, program) => ({ id, program, events: phrase })
  const w = await renderWindow(bank, [mk('piano', 0), mk('flute', 73), mk('violin', 40), mk('choir', 52), mk('tuba', 58)], 0, 3)
  const feat = (a) => {           // loudness and a brightness proxy (zero crossings)
    let s = 0, zc = 0
    for (let i = 0; i < a.length; i++) { s += a[i] * a[i]; if (i && (a[i - 1] < 0) !== (a[i] < 0)) zc++ }
    return { rms: Math.sqrt(s / a.length), zc }
  }
  const f = Object.fromEntries(w.stems.map(s => [s.id, feat(s.data)]))
  for (const k of Object.keys(f)) assert.ok(f[k].rms > 0.002, `${k} is audible`)
  const zcs = Object.values(f).map(x => x.zc)
  assert.ok(new Set(zcs.map(z => Math.round(z / 50))).size >= 4, 'timbres differ')
})

test('real sound bank: windows join sample-for-sample with one continuous render', { skip: !haveSF }, async () => {
  const { parseSoundBank, renderWindow } = await import('../audio/renderCore.js')
  const buf = fs.readFileSync(SF)
  const bank = parseSoundBank(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const tracks = [
    { id: 'a', program: 52, events: [0, 1, 2, 3].map(i => ({ t: i, d: 1.4, midi: 60 + i, vel: 85 })) },   // overlapping notes
    { id: 'd', unpitched: true, drumKey: 38, drumLow: null, program: 0, events: [0, 1, 2, 3].map(i => ({ t: i + 0.01, d: 0.2, midi: 60, vel: 100 })) },
  ]
  const full = await renderWindow(bank, tracks, 0, 6)
  const first = await renderWindow(bank, tracks, 0, 3)
  const second = await renderWindow(bank, tracks, 3, 6)
  let worst = 0
  full.stems.forEach((st, k) => {
    for (let i = 0; i < first.stems[k].data.length; i++) worst = Math.max(worst, Math.abs(st.data[i] - first.stems[k].data[i]))
    for (let i = 0; i < second.stems[k].data.length; i++) worst = Math.max(worst, Math.abs(st.data[first.stems[k].data.length + i] - second.stems[k].data[i]))
  })
  assert.equal(worst, 0)
})