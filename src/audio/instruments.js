// src/audio/instruments.js
// Every instrument / voice FaithScore can play, and what it sounds like.
//
// Sounds come from a General MIDI sound bank (the same FluidR3-based bank
// MuseScore ships as its default "MS Basic"). So each instrument is described
// by a GM *program* (a pitched instrument) or a GM *drum key* (an unpitched
// percussion instrument on the drum channel). Where General MIDI has no exact
// match (Wagner tuba, balalaika, clavichord …) the nearest instrument is used
// and `approx` says so, so the UI can be honest about it.
//
// Pitches in FaithScore are SOUNDING pitches, so no transposition is applied
// for B♭ clarinet, F horn, etc. — what is written is what is heard.

// id, name, group, program, options
//   program  GM program 0-127 (pitched)             — or —
//   drum     GM percussion key (unpitched), with `drumHigh`/`drumLow` to pick by pitch
//   vib      mod-wheel amount 0-127 (gentle vibrato on sustained instruments)
//   reverb   default reverb send 0-1 (dry kit vs. big hall voices)
//   pan      default pan -1 … 1
//   approx   true when General MIDI has no exact equivalent
const I = (id, name, group, program, o = {}) => ({
  id, name, group, program, drum: null, unpitched: false,
  vib: 0, reverb: 0.18, pan: 0, approx: false, ...o,
})
const D = (id, name, key, o = {}) => ({
  id, name, group: 'Unpitched percussion', program: 0, drum: key, unpitched: true,
  vib: 0, reverb: 0.12, pan: 0, approx: false, ...o,
})

export const INSTRUMENTS = [
  // ── Keyboards ────────────────────────────────────────────────────────────
  I('piano',            'Piano',             'Keyboards', 0, { reverb: 0.2 }),
  I('grand-piano',      'Grand Piano',       'Keyboards', 0, { reverb: 0.25 }),
  I('upright-piano',    'Upright Piano',     'Keyboards', 1, { reverb: 0.15 }),
  I('harpsichord',      'Harpsichord',       'Keyboards', 6, { reverb: 0.22 }),
  I('clavichord',       'Clavichord',        'Keyboards', 7, { approx: true }),
  I('organ-pipe',       'Organ — Pipe',      'Keyboards', 19, { reverb: 0.4 }),
  I('organ-electronic', 'Organ — Electronic','Keyboards', 16),
  I('electric-piano',   'Electric Piano',    'Keyboards', 4),
  I('electric-organ',   'Electric Organ',    'Keyboards', 18),
  I('synthesizer',      'Synthesizer',       'Keyboards', 50, { vib: 8 }),
  I('accordion',        'Accordion',         'Keyboards', 21, { vib: 6 }),
  I('melodica',         'Melodica',          'Keyboards', 22, { approx: true }),

  // ── Woodwinds ────────────────────────────────────────────────────────────
  I('piccolo',          'Piccolo',               'Woodwinds', 72, { vib: 14 }),
  I('flute',            'Flute',                 'Woodwinds', 73, { vib: 20 }),
  I('oboe',             'Oboe',                  'Woodwinds', 68, { vib: 16 }),
  I('clarinet-bb',      'Clarinet in B♭',        'Woodwinds', 71, { vib: 10 }),
  I('bass-clarinet-bb', 'Bass Clarinet in B♭',   'Woodwinds', 71, { vib: 10, approx: true }),
  I('soprano-sax',      'Soprano Saxophone',     'Woodwinds', 64, { vib: 16 }),
  I('alto-sax',         'Alto Saxophone',        'Woodwinds', 65, { vib: 16 }),
  I('tenor-sax',        'Tenor Saxophone',       'Woodwinds', 66, { vib: 16 }),
  I('baritone-sax',     'Baritone Saxophone',    'Woodwinds', 67, { vib: 14 }),
  I('bassoon',          'Bassoon',               'Woodwinds', 70, { vib: 10 }),
  I('contrabassoon',    'Contrabassoon',         'Woodwinds', 70, { vib: 8, approx: true }),
  I('harmonica',        'Harmonica',             'Woodwinds', 22, { vib: 6 }),
  I('concertina',       'Concertina',            'Woodwinds', 21, { vib: 6, approx: true }),

  // ── Brass ────────────────────────────────────────────────────────────────
  I('french-horn',      'French Horn',       'Brass', 60, { vib: 8 }),
  I('trumpet-bb',       'Trumpet in B♭',     'Brass', 56, { vib: 8 }),
  I('cornet',           'Cornet',            'Brass', 56, { vib: 8, approx: true }),
  I('flugelhorn',       'Flugelhorn',        'Brass', 56, { vib: 8, approx: true }),
  I('tenor-trombone',   'Tenor Trombone',    'Brass', 57, { vib: 6 }),
  I('bass-trombone',    'Bass Trombone',     'Brass', 57, { vib: 6, approx: true }),
  I('euphonium',        'Euphonium',         'Brass', 58, { vib: 6, approx: true }),
  I('baritone-horn',    'Baritone Horn',     'Brass', 58, { vib: 6, approx: true }),
  I('tuba',             'Tuba',              'Brass', 58, { vib: 4 }),
  I('wagner-tuba',      'Wagner Tuba',       'Brass', 60, { vib: 6, approx: true }),

  // ── Pitched percussion ───────────────────────────────────────────────────
  I('timpani',          'Timpani',           'Pitched percussion', 47, { reverb: 0.25 }),
  I('crotales',         'Crotales',          'Pitched percussion', 9,  { approx: true }),
  I('glockenspiel',     'Glockenspiel',      'Pitched percussion', 9),
  I('xylophone',        'Xylophone',         'Pitched percussion', 13),
  I('vibraphone',       'Vibraphone',        'Pitched percussion', 11, { reverb: 0.25 }),
  I('marimba',          'Marimba',           'Pitched percussion', 12),
  I('celesta',          'Celesta',           'Pitched percussion', 8),
  I('tubular-bells',    'Tubular Bells',     'Pitched percussion', 14, { reverb: 0.3 }),
  I('cimbalom',         'Cimbalom',          'Pitched percussion', 15, { approx: true }),

  // ── Plucked strings ──────────────────────────────────────────────────────
  I('classical-guitar', 'Classical Guitar',  'Plucked strings', 24),
  I('acoustic-guitar',  'Acoustic Guitar',   'Plucked strings', 25),
  I('electric-guitar',  'Electric Guitar',   'Plucked strings', 27),
  I('12-string-guitar', '12-String Guitar',  'Plucked strings', 25, { approx: true }),
  I('bass-guitar',      'Bass Guitar',       'Plucked strings', 33),
  I('ukulele',          'Ukulele',           'Plucked strings', 24, { approx: true }),
  I('banjo',            'Banjo',             'Plucked strings', 105),
  I('mandolin',         'Mandolin',          'Plucked strings', 25, { approx: true }),
  I('lute',             'Lute',              'Plucked strings', 24, { approx: true }),
  I('harp',             'Harp',              'Plucked strings', 46, { reverb: 0.25 }),
  I('balalaika',        'Balalaika',         'Plucked strings', 25, { approx: true }),
  I('sitar',            'Sitar',             'Plucked strings', 104),

  // ── Bowed strings ────────────────────────────────────────────────────────
  I('violin',           'Violin',            'Bowed strings', 40, { vib: 28, reverb: 0.25 }),
  I('viola',            'Viola',             'Bowed strings', 41, { vib: 26, reverb: 0.25 }),
  I('cello',            'Cello',             'Bowed strings', 42, { vib: 26, reverb: 0.25 }),
  I('double-bass',      'Double Bass',       'Bowed strings', 43, { vib: 14, reverb: 0.2 }),
  I('violin-1',         'Violin I',          'Bowed strings', 40, { vib: 28, reverb: 0.25 }),
  I('violin-2',         'Violin II',         'Bowed strings', 40, { vib: 28, reverb: 0.25 }),
  I('viola-da-gamba',   'Viola da Gamba',    'Bowed strings', 42, { vib: 12, approx: true }),
  I('hardanger-fiddle', 'Hardanger Fiddle',  'Bowed strings', 110, { vib: 14, approx: true }),

  // ── Unpitched percussion (GM drum kit) ───────────────────────────────────
  D('snare-drum',   'Snare Drum',   38),
  D('bass-drum',    'Bass Drum',    36, { reverb: 0.2 }),
  D('tenor-drum',   'Tenor Drum',   47, { approx: true }),
  D('bongo-drums',  'Bongo Drums',  60, { drumLow: 61 }),
  D('congas',       'Congas',       63, { drumLow: 64 }),
  D('timbales',     'Timbales',     65, { drumLow: 66 }),
  D('cymbals',      'Cymbals',      49, { reverb: 0.25, approx: true }),
  D('hi-hat',       'Hi-Hat',       42),
  D('crash-cymbal', 'Crash Cymbal', 49, { reverb: 0.25 }),
  D('ride-cymbal',  'Ride Cymbal',  51, { reverb: 0.2 }),
  D('tambourine',   'Tambourine',   54),
  D('triangle',     'Triangle',     81, { reverb: 0.25 }),
  D('woodblock',    'Woodblock',    76, { drumLow: 77 }),
  D('cowbell',      'Cowbell',      56),
  D('castanets',    'Castanets',    85),
  D('claves',       'Claves',       75),
  D('hand-claps',   'Hand Claps',   39),
  D('stomp',        'Stomp',        41, { approx: true }),
  D('finger-snaps', 'Finger Snaps', 37, { approx: true }),

  // ── Voices ───────────────────────────────────────────────────────────────
  // General MIDI has two sung timbres: "Choir Aahs" (52) and "Voice Oohs" (53).
  // Solo voices and choirs share them; each is given its own pan/vibrato.
  I('soprano-voice',      'Soprano Voice',        'Voices', 52, { vib: 24, reverb: 0.3, voice: true }),
  I('mezzo-soprano-voice','Mezzo-Soprano Voice',  'Voices', 52, { vib: 24, reverb: 0.3, voice: true }),
  I('alto-voice',         'Alto/Contralto Voice', 'Voices', 52, { vib: 22, reverb: 0.3, voice: true }),
  I('tenor-voice',        'Tenor Voice',          'Voices', 52, { vib: 22, reverb: 0.3, voice: true }),
  I('baritone-voice',     'Baritone Voice',       'Voices', 52, { vib: 20, reverb: 0.3, voice: true }),
  I('bass-voice',         'Bass Voice',           'Voices', 52, { vib: 18, reverb: 0.3, voice: true }),
  I('voice',              'Unspecified Voice',    'Voices', 52, { vib: 22, reverb: 0.3, voice: true }),
  I('satb-choir',         'SATB Choir',           'Voices', 52, { vib: 20, reverb: 0.35, voice: true }),
  I('ssa-choir',          'SSA Choir',            'Voices', 52, { vib: 20, reverb: 0.35, voice: true }),
  I('ttb-choir',          'TTB Choir',            'Voices', 52, { vib: 18, reverb: 0.35, voice: true }),
  I('backing-vocals',     'Backing Vocals',       'Voices', 53, { vib: 14, reverb: 0.3, voice: true }),
]

export const INSTRUMENT_BY_ID = Object.fromEntries(INSTRUMENTS.map((x) => [x.id, x]))
export const DEFAULT_INSTRUMENT_ID = 'piano'

export const INSTRUMENT_GROUPS = [
  'Keyboards', 'Woodwinds', 'Brass', 'Pitched percussion',
  'Plucked strings', 'Bowed strings', 'Unpitched percussion', 'Voices',
].map((g) => ({ group: g, items: INSTRUMENTS.filter((x) => x.group === g) }))

// Old scores stored free-text ids such as "piano" / "Piano" — anything unknown plays as piano.
export function getInstrument(id) {
  if (id && INSTRUMENT_BY_ID[id]) return INSTRUMENT_BY_ID[id]
  const slug = slugify(id)
  return INSTRUMENT_BY_ID[slug] || INSTRUMENT_BY_ID[DEFAULT_INSTRUMENT_ID]
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/♭/g, 'b').replace(/[—–]/g, '-')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// The GM drum key an unpitched instrument plays for a given (sounding) pitch.
export function drumKeyFor(inst, midi) {
  if (!inst?.drum) return null
  if (inst.drumLow != null && midi != null && midi < 60) return inst.drumLow
  return inst.drum
}

// Best guess at an instrument from a part's name (e.g. when importing MusicXML).
// `partCount` matters for "Bass"/"Tenor"/"Alto": in a 4-part score those are
// voices, in a piano score "Bass" is just the left-hand staff.
export function guessInstrumentId(name, partCount = 1) {
  const raw = String(name || '').trim()
  if (!raw) return DEFAULT_INSTRUMENT_ID
  const slug = slugify(raw)
  if (INSTRUMENT_BY_ID[slug]) return slug
  const exact = INSTRUMENTS.find((x) => slugify(x.name) === slug)
  if (exact) return exact.id
  const t = raw.toLowerCase()
  const has = (re) => re.test(t)
  if (has(/\bpiano\b|\bkeyboard\b/)) return 'piano'
  if (has(/\borgan\b/)) return 'organ-pipe'
  if (has(/\bviolin\b/)) return has(/\bii\b|\b2\b/) ? 'violin-2' : 'violin'
  if (has(/\bviola\b/)) return 'viola'
  if (has(/\bcello\b/)) return 'cello'
  if (has(/double bass|contrabass/)) return 'double-bass'
  if (has(/\bflute\b/)) return 'flute'
  if (has(/\boboe\b/)) return 'oboe'
  if (has(/clarinet/)) return 'clarinet-bb'
  if (has(/bassoon/)) return 'bassoon'
  if (has(/trumpet/)) return 'trumpet-bb'
  if (has(/trombone/)) return 'tenor-trombone'
  if (has(/horn/)) return 'french-horn'
  if (has(/\btuba\b/)) return 'tuba'
  if (has(/guitar/)) return has(/bass/) ? 'bass-guitar' : has(/electric/) ? 'electric-guitar' : 'acoustic-guitar'
  if (has(/\bharp\b/)) return 'harp'
  if (has(/timpani/)) return 'timpani'
  if (has(/sax/)) return has(/soprano/) ? 'soprano-sax' : has(/tenor/) ? 'tenor-sax' : has(/bari/) ? 'baritone-sax' : 'alto-sax'
  // voices
  // "Alto", "Tenor", "Bass" are only voices in a 3+ part score (in a 2-staff piano score "Bass" is the left hand)
  const voicey = partCount >= 3 || has(/voice|vocal|choir|sing|soprano|mezzo|contralto|baritone/)
  if (voicey) {
    if (has(/mezzo/)) return 'mezzo-soprano-voice'
    if (has(/soprano|^s\.?$|^sop/)) return 'soprano-voice'
    if (has(/alto|contralto|^a\.?$/)) return 'alto-voice'
    if (has(/baritone|^bar/)) return 'baritone-voice'
    if (has(/tenor|^t\.?$/)) return 'tenor-voice'
    if (has(/bass|^b\.?$/)) return 'bass-voice'
    if (has(/backing/)) return 'backing-vocals'
    if (has(/voice|vocal/)) return 'voice'
  }
  return DEFAULT_INSTRUMENT_ID
}