// src/components/HomeScreen/index.jsx
import { useState, useEffect, useRef } from 'react'
import { useScoreStore } from '../../store/scoreStore'
import { useSolfaStore } from '../../store/solfaStore'
import SolfaWizard from '../SolfaWizard'
import { supabase } from '../../lib/supabase'

// ─── Data ────────────────────────────────────────────────────────────────────

const FAMILIES = {
  'Woodwinds':            ['Piccolo','Flute','Oboe','Clarinet in Bb','Bass Clarinet in Bb','Soprano Saxophone','Alto Saxophone','Tenor Saxophone','Baritone Saxophone','Bassoon','Contrabassoon'],
  'Free Reed':            ['Harmonica','Melodica','Accordion','Concertina'],
  'Brass':                ['French Horn','Trumpet in Bb','Cornet','Flugelhorn','Tenor Trombone','Bass Trombone','Euphonium','Baritone Horn','Tuba','Wagner Tuba'],
  'Percussion - Pitched': ['Timpani','Crotales','Glockenspiel','Xylophone','Vibraphone','Marimba','Celesta','Tubular Bells','Cimbalom'],
  'Percussion - Unpitched':['Snare Drum','Bass Drum','Tenor Drum','Bongo Drums','Congas','Timbales','Cymbals','Hi-Hat','Crash Cymbal','Ride Cymbal','Tambourine','Triangle','Woodblock','Cowbell','Castanets','Claves'],
  'Percussion - Body':    ['Hand Claps','Stomp','Finger Snaps'],
  'Vocals':               ['Voice (Soprano)','Voice (Mezzo-Soprano)','Voice (Alto/Contralto)','Voice (Tenor)','Voice (Baritone)','Voice (Bass)','Voice (unspecified)','Choir (SATB)','Choir (SSA)','Choir (TTB)','Backing Vocals'],
  'Keyboards':            ['Piano','Grand Piano','Upright Piano','Harpsichord','Clavichord','Organ (Pipe)','Organ (Electronic)','Electric Piano','Electric Organ','Synthesizer','Accordion','Melodica'],
  'Strings - Plucked':    ['Classical Guitar','Acoustic Guitar','Electric Guitar','12-String Guitar','Bass Guitar','Ukulele','Banjo','Mandolin','Lute','Harp','Balalaika','Sitar'],
  'Strings - Bowed':      ['Violin','Viola','Cello','Double Bass','Violin I','Violin II','Viola da Gamba','Hardanger Fiddle'],
}

const INSTR_META = {
  'Piano':{ clef:'treble', id:'piano', bassClef:true },
  'Grand Piano':{ clef:'treble', id:'piano', bassClef:true },
  'Upright Piano':{ clef:'treble', id:'piano', bassClef:true },
  'Harpsichord':{ clef:'treble', id:'piano', bassClef:true },
  'Clavichord':{ clef:'treble', id:'piano', bassClef:true },
  'Organ (Pipe)':{ clef:'treble', id:'organ', bassClef:true },
  'Organ (Electronic)':{ clef:'treble', id:'organ', bassClef:true },
  'Electric Piano':{ clef:'treble', id:'piano', bassClef:true },
  'Electric Organ':{ clef:'treble', id:'organ', bassClef:true },
  'Synthesizer':{ clef:'treble', id:'piano', bassClef:true },
  'Accordion':{ clef:'treble', id:'piano', bassClef:false },
  'Melodica':{ clef:'treble', id:'flute', bassClef:false },
  'Classical Guitar':{ clef:'treble', id:'guitar', bassClef:false },
  'Acoustic Guitar':{ clef:'treble', id:'guitar', bassClef:false },
  'Electric Guitar':{ clef:'treble', id:'guitar', bassClef:false },
  '12-String Guitar':{ clef:'treble', id:'guitar', bassClef:false },
  'Bass Guitar':{ clef:'bass', id:'bass-guitar', bassClef:false },
  'Ukulele':{ clef:'treble', id:'guitar', bassClef:false },
  'Banjo':{ clef:'treble', id:'guitar', bassClef:false },
  'Mandolin':{ clef:'treble', id:'guitar', bassClef:false },
  'Lute':{ clef:'treble', id:'guitar', bassClef:false },
  'Harp':{ clef:'treble', id:'harp', bassClef:false },
  'Violin':{ clef:'treble', id:'violin', bassClef:false },
  'Violin I':{ clef:'treble', id:'violin', bassClef:false },
  'Violin II':{ clef:'treble', id:'violin', bassClef:false },
  'Viola':{ clef:'alto', id:'viola', bassClef:false },
  'Cello':{ clef:'bass', id:'cello', bassClef:false },
  'Double Bass':{ clef:'bass', id:'contrabass', bassClef:false },
  'Flute':{ clef:'treble', id:'flute', bassClef:false },
  'Piccolo':{ clef:'treble', id:'flute', bassClef:false },
  'Oboe':{ clef:'treble', id:'oboe', bassClef:false },
  'Clarinet in Bb':{ clef:'treble', id:'clarinet', bassClef:false },
  'Bass Clarinet in Bb':{ clef:'bass', id:'clarinet', bassClef:false },
  'Bassoon':{ clef:'bass', id:'bassoon', bassClef:false },
  'Contrabassoon':{ clef:'bass', id:'bassoon', bassClef:false },
  'French Horn':{ clef:'treble', id:'horn', bassClef:false },
  'Trumpet in Bb':{ clef:'treble', id:'trumpet', bassClef:false },
  'Cornet':{ clef:'treble', id:'trumpet', bassClef:false },
  'Flugelhorn':{ clef:'treble', id:'trumpet', bassClef:false },
  'Tenor Trombone':{ clef:'bass', id:'trombone', bassClef:false },
  'Bass Trombone':{ clef:'bass', id:'trombone', bassClef:false },
  'Euphonium':{ clef:'bass', id:'trombone', bassClef:false },
  'Baritone Horn':{ clef:'bass', id:'trombone', bassClef:false },
  'Tuba':{ clef:'bass', id:'tuba', bassClef:false },
  'Soprano Saxophone':{ clef:'treble', id:'clarinet', bassClef:false },
  'Alto Saxophone':{ clef:'treble', id:'clarinet', bassClef:false },
  'Tenor Saxophone':{ clef:'treble', id:'clarinet', bassClef:false },
  'Baritone Saxophone':{ clef:'bass', id:'clarinet', bassClef:false },
  'Harmonica':{ clef:'treble', id:'flute', bassClef:false },
  'Voice (Soprano)':{ clef:'treble', id:'soprano', bassClef:false },
  'Voice (Mezzo-Soprano)':{ clef:'treble', id:'soprano', bassClef:false },
  'Voice (Alto/Contralto)':{ clef:'treble', id:'alto', bassClef:false },
  'Voice (Tenor)':{ clef:'treble', id:'tenor', bassClef:false },
  'Voice (Baritone)':{ clef:'bass', id:'bass-voice', bassClef:false },
  'Voice (Bass)':{ clef:'bass', id:'bass-voice', bassClef:false },
  'Voice (unspecified)':{ clef:'treble', id:'soprano', bassClef:false },
  'Choir (SATB)':{ clef:'treble', id:'soprano', bassClef:false },
  'Choir (SSA)':{ clef:'treble', id:'soprano', bassClef:false },
  'Choir (TTB)':{ clef:'bass', id:'bass-voice', bassClef:false },
  'Backing Vocals':{ clef:'treble', id:'soprano', bassClef:false },
  'Timpani':{ clef:'bass', id:'piano', bassClef:false },
  'Glockenspiel':{ clef:'treble', id:'piano', bassClef:false },
  'Xylophone':{ clef:'treble', id:'piano', bassClef:false },
  'Vibraphone':{ clef:'treble', id:'piano', bassClef:false },
  'Marimba':{ clef:'treble', id:'piano', bassClef:false },
  'Celesta':{ clef:'treble', id:'piano', bassClef:false },
}

const TEMPLATES = {
  General: [
    { name:'Grand Staff',        parts:[{n:'Treble',clef:'treble',id:'piano'},{n:'Bass',clef:'bass',id:'piano-bass'}] },
    { name:'Lead Sheet',         parts:[{n:'Voice',clef:'treble',id:'soprano'},{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'Blank (Treble)',     parts:[{n:'Treble',clef:'treble',id:'piano'}] },
    { name:'Blank (Bass)',       parts:[{n:'Bass',clef:'bass',id:'piano-bass'}] },
  ],
  Choral: [
    { name:'SATB',               parts:[{n:'Soprano',clef:'treble',id:'soprano'},{n:'Alto',clef:'treble',id:'alto'},{n:'Tenor',clef:'treble',id:'tenor'},{n:'Bass',clef:'bass',id:'bass-voice'}] },
    { name:'SATB + Organ',       parts:[{n:'Soprano',clef:'treble',id:'soprano'},{n:'Alto',clef:'treble',id:'alto'},{n:'Tenor',clef:'treble',id:'tenor'},{n:'Bass',clef:'bass',id:'bass-voice'},{n:'Organ',clef:'treble',id:'organ'},{n:'Organ (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'SATB + Piano',       parts:[{n:'Soprano',clef:'treble',id:'soprano'},{n:'Alto',clef:'treble',id:'alto'},{n:'Tenor',clef:'treble',id:'tenor'},{n:'Bass',clef:'bass',id:'bass-voice'},{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'SATB Closed Score',  parts:[{n:'Soprano/Alto',clef:'treble',id:'soprano'},{n:'Tenor/Bass',clef:'bass',id:'bass-voice'}] },
    { name:'SATB Closed Score + Organ', parts:[{n:'Soprano/Alto',clef:'treble',id:'soprano'},{n:'Tenor/Bass',clef:'bass',id:'bass-voice'},{n:'Organ',clef:'treble',id:'organ'},{n:'Organ (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'SATB Closed Score + Piano', parts:[{n:'Soprano/Alto',clef:'treble',id:'soprano'},{n:'Tenor/Bass',clef:'bass',id:'bass-voice'},{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'Voice + Piano',      parts:[{n:'Voice',clef:'treble',id:'soprano'},{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'Barbershop Quartet (Men)',   parts:[{n:'Tenor',clef:'treble',id:'tenor'},{n:'Lead',clef:'treble',id:'tenor'},{n:'Baritone',clef:'bass',id:'bass-voice'},{n:'Bass',clef:'bass',id:'bass-voice'}] },
    { name:'Barbershop Quartet (Women)',parts:[{n:'Tenor',clef:'treble',id:'soprano'},{n:'Lead',clef:'treble',id:'soprano'},{n:'Baritone',clef:'treble',id:'alto'},{n:'Bass',clef:'treble',id:'alto'}] },
    { name:'Liturgical Unmetrical',     parts:[{n:'Soprano',clef:'treble',id:'soprano'},{n:'Alto',clef:'treble',id:'alto'},{n:'Tenor',clef:'treble',id:'tenor'},{n:'Bass',clef:'bass',id:'bass-voice'}] },
    { name:'Liturgical Unmetrical + Organ', parts:[{n:'Soprano',clef:'treble',id:'soprano'},{n:'Alto',clef:'treble',id:'alto'},{n:'Tenor',clef:'treble',id:'tenor'},{n:'Bass',clef:'bass',id:'bass-voice'},{n:'Organ',clef:'treble',id:'organ'},{n:'Organ (Bass)',clef:'bass',id:'piano-bass'}] },
  ],
  'Chamber Music': [
    { name:'String Quartet',     parts:[{n:'Violin I',clef:'treble',id:'violin'},{n:'Violin II',clef:'treble',id:'violin'},{n:'Viola',clef:'alto',id:'viola'},{n:'Cello',clef:'bass',id:'cello'}] },
    { name:'Piano Trio',         parts:[{n:'Violin',clef:'treble',id:'violin'},{n:'Cello',clef:'bass',id:'cello'},{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'Wind Quintet',       parts:[{n:'Flute',clef:'treble',id:'flute'},{n:'Oboe',clef:'treble',id:'oboe'},{n:'Clarinet in Bb',clef:'treble',id:'clarinet'},{n:'French Horn',clef:'treble',id:'horn'},{n:'Bassoon',clef:'bass',id:'bassoon'}] },
    { name:'Brass Quintet',      parts:[{n:'Trumpet I',clef:'treble',id:'trumpet'},{n:'Trumpet II',clef:'treble',id:'trumpet'},{n:'French Horn',clef:'treble',id:'horn'},{n:'Trombone',clef:'bass',id:'trombone'},{n:'Tuba',clef:'bass',id:'tuba'}] },
  ],
  Solo: [
    { name:'Voice Solo',         parts:[{n:'Voice',clef:'treble',id:'soprano'}] },
    { name:'Piano Solo',         parts:[{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'Guitar Solo',        parts:[{n:'Guitar',clef:'treble',id:'guitar'}] },
    { name:'Violin Solo',        parts:[{n:'Violin',clef:'treble',id:'violin'}] },
  ],
  Jazz: [
    { name:'Jazz Combo',         parts:[{n:'Trumpet',clef:'treble',id:'trumpet'},{n:'Alto Saxophone',clef:'treble',id:'clarinet'},{n:'Guitar',clef:'treble',id:'guitar'},{n:'Bass',clef:'bass',id:'bass-guitar'},{n:'Piano',clef:'treble',id:'piano'}] },
    { name:'Jazz Lead Sheet',    parts:[{n:'Lead',clef:'treble',id:'trumpet'},{n:'Piano',clef:'treble',id:'piano'},{n:'Piano (Bass)',clef:'bass',id:'piano-bass'}] },
    { name:'Big Band',           parts:[{n:'Alto Sax I',clef:'treble',id:'clarinet'},{n:'Alto Sax II',clef:'treble',id:'clarinet'},{n:'Tenor Sax I',clef:'treble',id:'clarinet'},{n:'Tenor Sax II',clef:'treble',id:'clarinet'},{n:'Baritone Sax',clef:'bass',id:'clarinet'},{n:'Trumpet I',clef:'treble',id:'trumpet'},{n:'Trumpet II',clef:'treble',id:'trumpet'},{n:'Trumpet III',clef:'treble',id:'trumpet'},{n:'Trumpet IV',clef:'treble',id:'trumpet'},{n:'Trombone I',clef:'bass',id:'trombone'},{n:'Trombone II',clef:'bass',id:'trombone'},{n:'Trombone III',clef:'bass',id:'trombone'},{n:'Bass Trombone',clef:'bass',id:'trombone'},{n:'Guitar',clef:'treble',id:'guitar'},{n:'Piano',clef:'treble',id:'piano'},{n:'Bass',clef:'bass',id:'bass-guitar'}] },
  ],
  Popular: [
    { name:'Rock Band',          parts:[{n:'Voice',clef:'treble',id:'soprano'},{n:'Guitar',clef:'treble',id:'guitar'},{n:'Bass Guitar',clef:'bass',id:'bass-guitar'},{n:'Piano',clef:'treble',id:'piano'}] },
    { name:'Singer-Songwriter',  parts:[{n:'Voice',clef:'treble',id:'soprano'},{n:'Guitar',clef:'treble',id:'guitar'}] },
  ],
  'Band and Percussion': [
    { name:'Marching Band',      parts:[{n:'Flute',clef:'treble',id:'flute'},{n:'Clarinet in Bb',clef:'treble',id:'clarinet'},{n:'Trumpet',clef:'treble',id:'trumpet'},{n:'Tenor Trombone',clef:'bass',id:'trombone'},{n:'Snare Drum',clef:'treble',id:'piano'}] },
    { name:'Concert Band',       parts:[{n:'Flute',clef:'treble',id:'flute'},{n:'Oboe',clef:'treble',id:'oboe'},{n:'Clarinet in Bb',clef:'treble',id:'clarinet'},{n:'Bass Clarinet in Bb',clef:'bass',id:'clarinet'},{n:'Alto Saxophone',clef:'treble',id:'clarinet'},{n:'Tenor Saxophone',clef:'treble',id:'clarinet'},{n:'Trumpet in Bb',clef:'treble',id:'trumpet'},{n:'French Horn',clef:'treble',id:'horn'},{n:'Tenor Trombone',clef:'bass',id:'trombone'},{n:'Euphonium',clef:'bass',id:'trombone'},{n:'Tuba',clef:'bass',id:'tuba'}] },
  ],
  Orchestral: [
    { name:'Full Orchestra',     parts:[{n:'Flute',clef:'treble',id:'flute'},{n:'Oboe',clef:'treble',id:'oboe'},{n:'Clarinet in Bb',clef:'treble',id:'clarinet'},{n:'Bassoon',clef:'bass',id:'bassoon'},{n:'French Horn I',clef:'treble',id:'horn'},{n:'French Horn II',clef:'treble',id:'horn'},{n:'Trumpet in Bb',clef:'treble',id:'trumpet'},{n:'Tenor Trombone',clef:'bass',id:'trombone'},{n:'Tuba',clef:'bass',id:'tuba'},{n:'Timpani',clef:'bass',id:'piano'},{n:'Violin I',clef:'treble',id:'violin'},{n:'Violin II',clef:'treble',id:'violin'},{n:'Viola',clef:'alto',id:'viola'},{n:'Cello',clef:'bass',id:'cello'},{n:'Double Bass',clef:'bass',id:'contrabass'}] },
    { name:'String Orchestra',   parts:[{n:'Violin I',clef:'treble',id:'violin'},{n:'Violin II',clef:'treble',id:'violin'},{n:'Viola',clef:'alto',id:'viola'},{n:'Cello',clef:'bass',id:'cello'},{n:'Double Bass',clef:'bass',id:'contrabass'}] },
    { name:'Piano Concerto',     parts:[{n:'Piano Solo',clef:'treble',id:'piano'},{n:'Piano Solo (Bass)',clef:'bass',id:'piano-bass'},{n:'Violin I',clef:'treble',id:'violin'},{n:'Violin II',clef:'treble',id:'violin'},{n:'Viola',clef:'alto',id:'viola'},{n:'Cello',clef:'bass',id:'cello'},{n:'Double Bass',clef:'bass',id:'contrabass'}] },
  ],
}

const KEY_SIGS = [
  {v:-7,label:'Cb major / Ab minor'},{v:-6,label:'Gb major / Eb minor'},
  {v:-5,label:'Db major / Bb minor'},{v:-4,label:'Ab major / F minor'},
  {v:-3,label:'Eb major / C minor'}, {v:-2,label:'Bb major / G minor'},
  {v:-1,label:'F major / D minor'},  {v:0, label:'C major / A minor'},
  {v:1, label:'G major / E minor'},  {v:2, label:'D major / B minor'},
  {v:3, label:'A major / F# minor'}, {v:4, label:'E major / C# minor'},
  {v:5, label:'B major / G# minor'}, {v:6, label:'F# major / D# minor'},
  {v:7, label:'C# major / A# minor'},
]
const TIME_SIGS = [
  {l:'2/2',b:2,bt:2},{l:'2/4',b:2,bt:4},{l:'3/4',b:3,bt:4},
  {l:'4/4',b:4,bt:4},{l:'3/8',b:3,bt:8},{l:'6/8',b:6,bt:8},
  {l:'9/8',b:9,bt:8},{l:'12/8',b:12,bt:8},{l:'5/4',b:5,bt:4},
  {l:'7/8',b:7,bt:8},
]

// ─── Score factory ────────────────────────────────────────────────────────────
function buildScore(partDefs, meta) {
  const ts = { beats: meta.timeSig.b, beatType: meta.timeSig.bt }
  const makeRest = () => ({
    id: crypto.randomUUID(), isRest: true, pitch: null,
    duration: ts.beats >= 4 ? 'w' : ts.beats >= 2 ? 'h' : 'q', dots: 0,
  })
  const makeMeasure = () => ({
    id: crypto.randomUUID(), timeSignature: ts, keySignature: meta.key,
    barline: 'single', notes: [makeRest()],
  })
  return {
    id: crypto.randomUUID(),
    title: meta.title || 'Untitled Score',
    composer: meta.composer || '',
    subtitle: meta.subtitle || '',
    lyricist: meta.lyricist || '',
    copyright: meta.copyright || '',
    tempo: meta.tempo,
    _savedAt: Date.now(),
    dynamics: [], hairpins: [], rehearsalMarks: [], staffTexts: [],
    parts: partDefs.map(p => ({
      id: crypto.randomUUID(), name: p.n, instrument: p.id, clef: p.clef,
      measures: Array.from({ length: meta.measures }, makeMeasure),
    })),
  }
}

// ─── Mini score thumbnail ─────────────────────────────────────────────────────
function Thumbnail({ score }) {
  const parts = Math.min(score?.parts?.length || 2, 5)
  return (
    <svg width="100%" height="100%" viewBox="0 0 130 100" preserveAspectRatio="xMidYMid meet">
      <rect width="130" height="100" fill="white"/>
      {/* Title stub */}
      <rect x="30" y="6" width="70" height="3" rx="1" fill="#ccc"/>
      <rect x="45" y="11" width="40" height="2" rx="1" fill="#ddd"/>
      {/* Parts */}
      {Array.from({length: parts}).map((_,pi) => {
        const y0 = 18 + pi * 16
        return (
          <g key={pi}>
            <text x="5" y={y0+8} fontSize="8" fill="#444" fontFamily="serif">
              {pi % 2 === 0 ? '𝄞' : '𝄢'}
            </text>
            {[0,1,2,3,4].map(li => (
              <line key={li} x1="14" y1={y0+li*2} x2="122" y2={y0+li*2}
                stroke="#888" strokeWidth="0.35"/>
            ))}
            {[40,70,100].map(x => (
              <line key={x} x1={x} y1={y0} x2={x} y2={y0+8}
                stroke="#888" strokeWidth="0.35"/>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

// ─── New Score Wizard ─────────────────────────────────────────────────────────
function Wizard({ onDone, onCancel }) {
  const [page,  setPage]  = useState(1)
  const [tab,   setTab]   = useState('instruments')

  // Page 1 – instruments
  const [family,  setFamily]  = useState('Keyboards')
  const [search,  setSearch]  = useState('')
  const [selInstr,setSelInstr]= useState(null)
  const [parts,   setParts]   = useState([])

  // Page 1 – template
  const [tCat, setTCat] = useState('Choral')
  const [tSel, setTSel] = useState(TEMPLATES.Choral[2])

  // Page 2
  const [key,      setKey]      = useState(0)
  const [timeSig,  setTimeSig]  = useState({b:4,bt:4,l:'4/4'})
  const [tempo,    setTempo]    = useState(120)
  const [measures, setMeasures] = useState(32)
  const [title,    setTitle]    = useState('')
  const [composer, setComposer] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [lyricist, setLyricist] = useState('')
  const [copyright,setCopyright]= useState('')

  const loadScore = useScoreStore(s => s.loadScore)

  // Filtered instrument list
  const searchLC = search.toLowerCase()
  const filteredFamilies = search
    ? Object.keys(FAMILIES).filter(f => FAMILIES[f].some(i => i.toLowerCase().includes(searchLC)))
    : Object.keys(FAMILIES)
  const filteredInstrs = search
    ? (FAMILIES[filteredFamilies[0]] || []).filter(i => i.toLowerCase().includes(searchLC))
    : (FAMILIES[family] || [])
  const displayFamily = search ? (filteredFamilies[0] || family) : family

  function addPart(instrName) {
    const m = INSTR_META[instrName] || { clef:'treble', id:'piano', bassClef:false }
    const newParts = [{ n: instrName, clef: m.clef, id: m.id, uid: crypto.randomUUID() }]
    if (m.bassClef) newParts.push({ n: instrName+' (Bass)', clef:'bass', id: m.id+'-bass', uid: crypto.randomUUID() })
    setParts(p => [...p, ...newParts])
    setSelInstr(instrName)
  }

  function finish() {
    const partDefs = tab === 'template' ? tSel.parts : parts
    if (!partDefs.length) { alert('Add at least one instrument.'); return }
    loadScore(buildScore(partDefs, { key, timeSig, tempo, measures, title, composer, subtitle, lyricist, copyright }))
    onDone()
  }

  const canProceed = tab === 'template' || parts.length > 0
  const keyLabel = KEY_SIGS.find(k => k.v === key)?.label || 'C major / A minor'

  // ── Shared styles ────────────────────────────────────────────────────────
  const ov = { position:'fixed', inset:0, background:'rgba(30,30,40,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }
  const md = { background:'#fff', borderRadius:12, width:960, maxWidth:'96vw', height:620, display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,0.3)', overflow:'hidden' }
  const hd = { padding:'0 28px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }
  const ft = { padding:'12px 24px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0, background:'#fafafa' }
  const btn  = (a) => ({ padding:'7px 20px', borderRadius:6, border:'1px solid #d1d5db', background: a?'#2563eb':'white', color: a?'white':'#374151', cursor:'pointer', fontSize:13, fontWeight:500 })
  const tabS = (a) => ({ padding:'10px 22px', border:'none', background:'none', cursor:'pointer', fontSize:13.5, fontWeight:500, color: a?'#1d4ed8':'#6b7280', borderBottom: a?'2px solid #2563eb':'2px solid transparent', marginBottom:'-1px' })

  // ── Page 2 ────────────────────────────────────────────────────────────────
  if (page === 2) return (
    <div style={ov}>
      <div style={md}>
        <div style={{ ...hd, paddingTop:18, paddingBottom:0 }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:4 }}>
            <span style={{ fontSize:13, color:'#6b7280' }}>🎵 New score</span>
            <button onClick={onCancel} style={{ marginLeft:'auto', border:'none', background:'none', cursor:'pointer', fontSize:20, color:'#aaa', lineHeight:1 }}>×</button>
          </div>
          <h2 style={{ margin:'8px 0 16px', textAlign:'center', fontSize:18, fontWeight:600, color:'#111' }}>Additional score information</h2>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'20px 36px' }}>
          {/* 4 info cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:22 }}>
            {/* Key signature */}
            <div style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 10px', background:'#f8fafc', textAlign:'center' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>Key signature</div>
              <div style={{ fontSize:28, marginBottom:8 }}>𝄞</div>
              <div style={{ fontSize:11.5, color:'#334155', marginBottom:8, fontWeight:500 }}>
                {keyLabel.split(' / ')[0]}
              </div>
              <select value={key} onChange={e=>setKey(Number(e.target.value))}
                style={{ width:'100%', fontSize:11, border:'1px solid #cbd5e1', borderRadius:5, padding:'3px 4px', background:'white', color:'#334155' }}>
                {KEY_SIGS.map(k=><option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </div>

            {/* Time signature */}
            <div style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 10px', background:'#f8fafc', textAlign:'center' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>Time signature</div>
              <div style={{ fontSize:30, fontFamily:'serif', fontWeight:700, color:'#1e293b', marginBottom:8, lineHeight:1.1 }}>{timeSig.b}<br/><span style={{ borderTop:'3px solid #1e293b', display:'inline-block', width:24, textAlign:'center' }}>{timeSig.bt}</span></div>
              <select value={timeSig.l} onChange={e=>{const t=TIME_SIGS.find(x=>x.l===e.target.value);if(t)setTimeSig(t)}}
                style={{ width:'100%', fontSize:11, border:'1px solid #cbd5e1', borderRadius:5, padding:'3px 4px', background:'white', color:'#334155' }}>
                {TIME_SIGS.map(t=><option key={t.l} value={t.l}>{t.l}</option>)}
              </select>
            </div>

            {/* Tempo */}
            <div style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 10px', background:'#f8fafc', textAlign:'center' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>Tempo</div>
              <div style={{ fontSize:17, fontWeight:600, color:'#1e293b', marginBottom:6 }}>♩ = {tempo}</div>
              <input type="range" min={20} max={300} value={tempo} onChange={e=>setTempo(+e.target.value)}
                style={{ width:'100%', marginBottom:6 }} />
              <input type="number" value={tempo} min={20} max={300}
                onChange={e=>setTempo(Math.max(20,Math.min(300,+e.target.value||120)))}
                style={{ width:64, textAlign:'center', border:'1px solid #cbd5e1', borderRadius:5, fontSize:12, padding:'2px 4px' }} />
            </div>

            {/* Measures */}
            <div style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 10px', background:'#f8fafc', textAlign:'center' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>Measures</div>
              <div style={{ fontSize:24, fontWeight:700, color:'#1e293b', marginBottom:4 }}>{measures}</div>
              <div style={{ fontSize:11.5, color:'#64748b', marginBottom:10 }}>measures, no pickup</div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <button onClick={()=>setMeasures(m=>Math.max(1,m-1))} style={{ width:26,height:26,borderRadius:5,border:'1px solid #d1d5db',background:'white',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>−</button>
                <input type="number" value={measures} min={1} max={999}
                  onChange={e=>setMeasures(Math.max(1,Math.min(999,+e.target.value||1)))}
                  style={{ width:52, textAlign:'center', border:'1px solid #cbd5e1', borderRadius:5, fontSize:12, padding:'2px 4px' }} />
                <button onClick={()=>setMeasures(m=>Math.min(999,m+1))} style={{ width:26,height:26,borderRadius:5,border:'1px solid #d1d5db',background:'white',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>+</button>
              </div>
            </div>
          </div>

          {/* Text fields */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {[{l:'Title',v:title,s:setTitle,p:'Untitled score'},{l:'Composer',v:composer,s:setComposer,p:'Composer / arranger'},{l:'Subtitle',v:subtitle,s:setSubtitle,p:'Subtitle'},{l:'Lyricist',v:lyricist,s:setLyricist,p:'Lyricist'}].map(f=>(
              <div key={f.l}>
                <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:5 }}>{f.l}</label>
                <input value={f.v} onChange={e=>f.s(e.target.value)} placeholder={f.p}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, outline:'none', boxSizing:'border-box', background:'white' }}/>
              </div>
            ))}
            <div style={{ gridColumn:'1/-1' }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:5 }}>Copyright</label>
              <textarea value={copyright} onChange={e=>setCopyright(e.target.value)} rows={3}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box' }} />
            </div>
          </div>
        </div>

        <div style={ft}>
          <button style={btn(false)} onClick={onCancel}>Cancel</button>
          <div style={{ display:'flex', gap:10 }}>
            <button style={btn(false)} onClick={()=>setPage(1)}>Back</button>
            <button style={btn(true)} onClick={finish}>Done</button>
          </div>
        </div>
      </div>
    </div>
  )

  // ── Page 1 ────────────────────────────────────────────────────────────────
  return (
    <div style={ov}>
      <div style={md}>
        {/* Header */}
        <div style={{ ...hd, paddingTop:14, paddingBottom:0 }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <img src="/FaithScore_logo.png" alt="" style={{ height:18, width:'auto' }} />
              <span style={{ fontWeight:600, fontSize:14, color:'#1e2433' }}>New score</span>
            </div>
            <button onClick={onCancel} style={{ marginLeft:'auto', border:'none', background:'none', cursor:'pointer', fontSize:22, color:'#9ca3af', lineHeight:1, padding:'0 2px' }}>×</button>
          </div>
          <div style={{ display:'flex', borderBottom:'none' }}>
            <button style={tabS(tab==='instruments')} onClick={()=>setTab('instruments')}>Choose instruments</button>
            <button style={tabS(tab==='template')} onClick={()=>setTab('template')}>Create from template</button>
          </div>
        </div>

        {/* ── INSTRUMENTS TAB ─────────────────────────────────────────────── */}
        {tab === 'instruments' && (
          <div style={{ flex:1, display:'grid', gridTemplateColumns:'190px 1fr 215px', overflow:'hidden', borderTop:'1px solid #e5e7eb' }}>
            {/* Family */}
            <div style={{ borderRight:'1px solid #e5e7eb', overflowY:'auto', background:'#fafafa' }}>
              <div style={{ padding:'8px 14px 4px', fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em' }}>Family</div>
              {Object.keys(FAMILIES).map(f=>(
                <button key={f} onClick={()=>{setFamily(f);setSearch('')}}
                  style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 16px', border:'none', fontSize:13, cursor:'pointer', borderLeft: (!search&&family===f)?'3px solid #2563eb':'3px solid transparent', background:(!search&&family===f)?'#eff6ff':'transparent', color:(!search&&family===f)?'#1d4ed8':'#374151', fontWeight:(!search&&family===f)?600:400 }}>
                  {f}
                </button>
              ))}
            </div>

            {/* Instruments */}
            <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', borderRight:'1px solid #e5e7eb' }}>
              {/* Search */}
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'#f3f4f6', borderRadius:7, padding:'6px 11px', border:'1px solid #e5e7eb' }}>
                  <span style={{ color:'#9ca3af', fontSize:13 }}>⌕</span>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search"
                    style={{ border:'none', background:'none', outline:'none', fontSize:13, flex:1, color:'#374151' }}/>
                  {search && <button onClick={()=>setSearch('')} style={{ border:'none', background:'none', cursor:'pointer', fontSize:15, color:'#9ca3af', lineHeight:1 }}>×</button>}
                </div>
              </div>
              {/* List */}
              <div style={{ flex:1, overflowY:'auto' }}>
                {filteredInstrs.length === 0
                  ? <div style={{ padding:'20px', textAlign:'center', color:'#9ca3af', fontSize:13 }}>No instruments found</div>
                  : filteredInstrs.map(i=>(
                    <button key={i} onClick={()=>setSelInstr(i)} onDoubleClick={()=>addPart(i)}
                      style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 18px', border:'none', fontSize:13, cursor:'pointer', background:selInstr===i?'#dbeafe':'transparent', color:'#1e2433', borderLeft:selInstr===i?'3px solid #2563eb':'3px solid transparent' }}>
                      {i}
                    </button>
                  ))
                }
              </div>
              {/* Add button row */}
              {selInstr && (
                <div style={{ padding:'10px 14px', borderTop:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, background:'#f9fafb' }}>
                  <span style={{ fontSize:11.5, color:'#6b7280' }}>{selInstr}</span>
                  <button onClick={()=>addPart(selInstr)}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 14px', background:'#2563eb', color:'white', border:'none', borderRadius:6, cursor:'pointer', fontSize:12.5, fontWeight:500 }}>
                    Add to score →
                  </button>
                </div>
              )}
            </div>

            {/* Your score */}
            <div style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ padding:'8px 14px 6px', fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', flexShrink:0, borderBottom:'1px solid #f0f0f0' }}>Your score</div>
              <div style={{ flex:1, overflowY:'auto' }}>
                {parts.length === 0
                  ? <div style={{ padding:'30px 16px', textAlign:'center', color:'#9ca3af', fontSize:12.5, lineHeight:1.6 }}>Choose your instruments<br/>by adding them to this list</div>
                  : parts.map((p,i)=>(
                    <div key={p.uid} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderBottom:'1px solid #f3f4f6', fontSize:13 }}>
                      <span style={{ fontSize:14, color:'#64748b' }}>{p.clef==='treble'?'𝄞':'𝄢'}</span>
                      <span style={{ flex:1, color:'#1e2433' }}>{p.n}</span>
                      <button onClick={()=>setParts(ps=>ps.filter(x=>x.uid!==p.uid))}
                        style={{ border:'none', background:'none', cursor:'pointer', color:'#9ca3af', fontSize:14, lineHeight:1, padding:'0 2px' }}>×</button>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        )}

        {/* ── TEMPLATE TAB ────────────────────────────────────────────────── */}
        {tab === 'template' && (
          <div style={{ flex:1, display:'grid', gridTemplateColumns:'185px 1fr 320px', overflow:'hidden', borderTop:'1px solid #e5e7eb' }}>
            {/* Category */}
            <div style={{ borderRight:'1px solid #e5e7eb', overflowY:'auto', background:'#fafafa' }}>
              <div style={{ padding:'8px 14px 4px', fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em' }}>Category</div>
              {Object.keys(TEMPLATES).map(cat=>(
                <button key={cat} onClick={()=>{setTCat(cat);setTSel(TEMPLATES[cat][0])}}
                  style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 18px', border:'none', fontSize:13, cursor:'pointer', background:tCat===cat?'#eff6ff':'transparent', color:tCat===cat?'#1d4ed8':'#374151', borderLeft:tCat===cat?'3px solid #2563eb':'3px solid transparent', fontWeight:tCat===cat?600:400 }}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Template list */}
            <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', borderRight:'1px solid #e5e7eb' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'#f3f4f6', borderRadius:7, padding:'6px 11px', border:'1px solid #e5e7eb' }}>
                  <span style={{ color:'#9ca3af', fontSize:13 }}>⌕</span>
                  <input placeholder="Search" style={{ border:'none', background:'none', outline:'none', fontSize:13, flex:1, color:'#374151' }}/>
                </div>
              </div>
              <div style={{ flex:1, overflowY:'auto' }}>
                {(TEMPLATES[tCat]||[]).map(t=>(
                  <button key={t.name} onClick={()=>setTSel(t)}
                    style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 18px', border:'none', fontSize:13, cursor:'pointer', background:tSel?.name===t.name?'#dbeafe':'transparent', color:'#1e2433', borderLeft:tSel?.name===t.name?'3px solid #2563eb':'3px solid transparent' }}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ padding:'8px 14px 6px', fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', flexShrink:0, borderBottom:'1px solid #f0f0f0' }}>Preview</div>
              {tSel && (
                <div style={{ flex:1, overflowY:'auto', padding:'14px' }}>
                  <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:8, padding:'14px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div style={{ textAlign:'center', fontWeight:600, fontSize:13, color:'#1e293b', marginBottom:12 }}>{tSel.name}</div>
                    {tSel.parts.map((p,i)=>(
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:7 }}>
                        <span style={{ fontSize:14, color:'#475569', width:16 }}>{p.clef==='treble'?'𝄞':p.clef==='bass'?'𝄢':'𝄡'}</span>
                        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'1px' }}>
                          {[0,1,2,3,4].map(li=><div key={li} style={{ height:'1px', background:'#aaa' }}/>)}
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop:10, fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>
                      {tSel.parts.map(p=>p.n).join(' · ')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={ft}>
          <div style={{ fontSize:12, color:'#6b7280' }}>
            {tab==='instruments' && selInstr && `${selInstr}`}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button style={btn(false)} onClick={onCancel}>Cancel</button>
            <button style={{ ...btn(false), opacity: canProceed?1:0.4 }} onClick={()=>canProceed&&setPage(2)}>Next</button>
            <button style={{ ...btn(true), opacity: canProceed?1:0.6 }} onClick={finish}>Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Time-ago ─────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return ''
  const d = Date.now() - ts
  if (d < 60000)      return 'Just now'
  if (d < 3600000)    return Math.floor(d/60000)+'m ago'
  if (d < 86400000)   return Math.floor(d/3600000)+'h ago'
  if (d < 604800000)  return Math.floor(d/86400000)+' days ago'
  if (d < 2592000000) return Math.floor(d/604800000)+' weeks ago'
  return Math.floor(d/2592000000)+' months ago'
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
export default function HomeScreen({ onOpenEditor, onOpenSolfaEditor, user, onSignOut }) {
  const [wizard,       setWizard]       = useState(false)
  const [solfaWizard,  setSolfaWizard]  = useState(false)
  const [recent,    setRecent]    = useState([])
  const [cloudSaving, setCloudSaving] = useState(false)
  const [cloudMsg,  setCloudMsg]  = useState('')
  const [viewMode,  setViewMode]  = useState('grid')
  const [tab,       setTab]       = useState('recent')
  const [nav,       setNav]       = useState('scores')
  const loadScore      = useScoreStore(s => s.loadScore)
  const loadSolfaScore = useSolfaStore(s => s.loadScore)
  const score      = useScoreStore(s => s.score)

  // Load scores: cloud first (if logged in), then localStorage fallback
  useEffect(() => {
    async function fetchScores() {
      if (user) {
        try {
          const { data, error } = await supabase
            .from('scores')
            .select('id, title, updated_at, data')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false })
            .limit(50)
          if (!error && data) {
            setRecent(data.map(row => ({
              key: row.id,
              score: row.data,
              title: row.title,
              ts: new Date(row.updated_at).getTime(),
              cloudId: row.id,
            })))
            return
          }
        } catch {}
      }
      // localStorage fallback
      try {
        const items = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (!k?.startsWith('faithscore')) continue
          try {
            const s = JSON.parse(localStorage.getItem(k))
            if (s?.parts) items.push({ key: k, score: s, ts: s._savedAt || 0 })
          } catch {}
        }
        setRecent(items.sort((a,b)=>b.ts-a.ts))
      } catch {}
    }
    fetchScores()
  }, [user])

  // Save current score to cloud
  const saveToCloud = async (scoreToSave, existingCloudId) => {
    if (!user) return
    setCloudSaving(true)
    setCloudMsg('')
    try {
      const currentScore = scoreToSave || useScoreStore.getState().score
      let error
      if (existingCloudId) {
        // Update existing cloud record
        ;({ error } = await supabase.from('scores')
          .update({ title: currentScore.title || 'Untitled Score', data: currentScore, updated_at: new Date().toISOString() })
          .eq('id', existingCloudId)
          .eq('user_id', user.id))
      } else {
        // Insert new record
        ;({ error } = await supabase.from('scores').insert([{
          user_id: user.id,
          title: currentScore.title || 'Untitled Score',
          data: currentScore,
        }]))
      }
      if (error) throw error
      setCloudMsg('Saved ✓')
      setTimeout(() => setCloudMsg(''), 3000)
      // Refresh list
      const { data } = await supabase.from('scores').select('id,title,updated_at,data')
        .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(50)
      if (data) setRecent(data.map(row => ({
        key: row.id, score: row.data, title: row.title,
        ts: new Date(row.updated_at).getTime(), cloudId: row.id,
      })))
    } catch (err) {
      setCloudMsg('Save failed: ' + (err.message || 'unknown error'))
    }
    setCloudSaving(false)
  }

  const deleteCloudScore = async (cloudId) => {
    if (!user || !cloudId) return
    if (!window.confirm('Delete this score from your account?')) return
    await supabase.from('scores').delete().eq('id', cloudId).eq('user_id', user.id)
    setRecent(r => r.filter(x => x.cloudId !== cloudId))
  }

  function openScore(s, cloudId) {
    if (s?.type === 'solfa') {
      // Route solfa scores to the solfa editor
      loadSolfaScore({ ...s, _cloudId: cloudId || s._cloudId || null })
      onOpenSolfaEditor()
    } else {
      loadScore(s)
      if (cloudId) useScoreStore.setState(st => ({ score: { ...st.score, _cloudId: cloudId } }))
      onOpenEditor()
    }
  }
  async function handleSolfaWizardDone(newScore) {
    setSolfaWizard(false)
    loadSolfaScore(newScore)
    if (user) {
      try {
        const { data } = await supabase.from('scores')
          .insert([{ user_id: user.id, title: newScore.title || 'Untitled', data: newScore }])
          .select('id').single()
        if (data?.id) useSolfaStore.getState().setCloudId(data.id)
        const { data: scores } = await supabase.from('scores')
          .select('id,title,updated_at,data').eq('user_id', user.id)
          .order('updated_at', { ascending: false }).limit(50)
        if (scores) setRecent(scores.map(row => ({
          key: row.id, score: row.data, title: row.title,
          ts: new Date(row.updated_at).getTime(), cloudId: row.id,
        })))
      } catch(e) { console.warn('Solfa auto-save failed:', e) }
    }
    onOpenSolfaEditor()
  }

  async function handleWizardDone() {
    setWizard(false)
    // Auto-save the newly created score to cloud immediately
    if (user) {
      const currentScore = useScoreStore.getState().score
      try {
        await supabase.from('scores').insert([{
          user_id: user.id,
          title: currentScore.title || 'Untitled Score',
          data: currentScore,
        }])
        // Refresh list
        const { data } = await supabase.from('scores')
          .select('id,title,updated_at,data')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(50)
        if (data) setRecent(data.map(row => ({
          key: row.id, score: row.data, title: row.title,
          ts: new Date(row.updated_at).getTime(), cloudId: row.id,
        })))
      } catch(e) { console.warn('Auto-save failed:', e) }
    }
    onOpenEditor()
  }

  const NAV = [
    { id:'scores',  icon:'♪',  label:'Scores'       },
    { id:'plugins', icon:'⊞',  label:'Plugins'      },
    { id:'sounds',  icon:'♫',  label:'FaithSounds'  },
    { id:'learn',   icon:'📖', label:'Learn'        },
  ]

  return (
    <div style={{ display:'flex', height:'100vh', background:'#eef0f3', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', overflow:'hidden' }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside style={{ width:220, background:'#f4f5f7', borderRight:'1px solid #dde1e7', display:'flex', flexDirection:'column', flexShrink:0 }}>
        {/* Profile */}
        <div style={{ padding:'20px 16px 16px', borderBottom:'1px solid #dde1e7' }}>
          <div style={{ display:'flex', alignItems:'center', gap:11 }}>
            <div style={{ width:40, height:40, borderRadius:'50%', background:'linear-gradient(135deg,#2563eb 0%,#7c3aed 100%)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:15, flexShrink:0 }}>
              {user ? (user.user_metadata?.full_name || user.email || '?')[0].toUpperCase() : 'F'}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#1e2433', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'FaithScore'}
              </div>
              <div style={{ fontSize:11, color:'#8892a4', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {user?.email || 'My workspace'}
              </div>
            </div>
          </div>
          {user && onSignOut && (
            <button onClick={onSignOut}
              style={{ marginTop:10, width:'100%', padding:'5px 0', fontSize:11, color:'#6b7280',
                background:'none', border:'1px solid #dde1e7', borderRadius:5, cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.color='#dc2626'}
              onMouseLeave={e=>e.currentTarget.style.color='#6b7280'}>
              Sign out
            </button>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'8px 0' }}>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setNav(n.id)}
              style={{ display:'flex', alignItems:'center', gap:11, width:'100%', padding:'10px 18px', border:'none', background: nav===n.id?'#e0e7ff':'transparent', cursor:'pointer', textAlign:'left', fontSize:13.5, color: nav===n.id?'#3730a3':'#374151', fontWeight: nav===n.id?600:400, borderLeft: nav===n.id?'3px solid #4f46e5':'3px solid transparent' }}>
              <span style={{ fontSize:16, width:18, textAlign:'center' }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        {/* Score manager */}
        <div style={{ padding:'12px 14px', borderTop:'1px solid #dde1e7' }}>
          <button style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:7, background:'white', cursor:'pointer', fontSize:12, color:'#374151', fontWeight:500 }}>
            Score manager (online)
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Top navigation bar */}
        <div style={{ background:'white', borderBottom:'1px solid #dde1e7', padding:'0 24px', display:'flex', alignItems:'center', height:48, flexShrink:0, gap:2 }}>
          {['Home','Score','Publish'].map((t,i)=>(
            <button key={t} style={{ padding:'12px 16px', border:'none', background:'none', cursor:'pointer', fontSize:13.5, fontWeight: i===0?600:400, color: i===0?'#1d4ed8':'#6b7280', borderBottom: i===0?'2px solid #2563eb':'2px solid transparent', marginBottom:'-1px' }}>
              {t}
            </button>
          ))}
          <div style={{ flex:1 }}/>
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'#f3f4f6', borderRadius:8, padding:'6px 14px', minWidth:200 }}>
            <span style={{ color:'#9ca3af', fontSize:13 }}>🔍</span>
            <input placeholder="Search scores…" style={{ border:'none', background:'none', outline:'none', fontSize:13, flex:1, color:'#374151' }}/>
          </div>
        </div>

        {/* Content */}
        {nav === 'scores' ? (
          <div style={{ flex:1, overflowY:'auto', padding:'30px 36px' }}>
            {/* Header row */}
            <div style={{ display:'flex', alignItems:'flex-end', marginBottom:22 }}>
              <h1 style={{ margin:0, fontSize:28, fontWeight:700, color:'#1e2433', letterSpacing:'-0.5px' }}>Scores</h1>
              <div style={{ flex:1 }}/>
              <div style={{ display:'flex', gap:2, background:'#e5e7eb', borderRadius:7, padding:'3px' }}>
                <button onClick={()=>setViewMode('grid')} style={{ padding:'5px 10px', borderRadius:5, border:'none', background:viewMode==='grid'?'white':'transparent', cursor:'pointer', fontSize:16, color:viewMode==='grid'?'#1e2433':'#9ca3af', boxShadow:viewMode==='grid'?'0 1px 3px rgba(0,0,0,0.1)':'' }}>⊞</button>
                <button onClick={()=>setViewMode('list')} style={{ padding:'5px 10px', borderRadius:5, border:'none', background:viewMode==='list'?'white':'transparent', cursor:'pointer', fontSize:16, color:viewMode==='list'?'#1e2433':'#9ca3af', boxShadow:viewMode==='list'?'0 1px 3px rgba(0,0,0,0.1)':'' }}>☰</button>
              </div>
            </div>

            {/* Tabs + cloud save */}
            <div style={{ display:'flex', alignItems:'center', borderBottom:'1px solid #dde1e7', marginBottom:24, gap:0 }}>
              {[{id:'recent',l:'My Scores'}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{ padding:'8px 18px', border:'none', background:'none', cursor:'pointer', fontSize:13.5, fontWeight: tab===t.id?600:400, color: tab===t.id?'#2563eb':'#6b7280', borderBottom: tab===t.id?'2px solid #2563eb':'2px solid transparent', marginBottom:'-1px' }}>
                  {t.l}
                </button>
              ))}
              <div style={{ flex:1 }} />
              {user && (
                <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:8 }}>
                  {cloudMsg && (
                    <span style={{ fontSize:12, color: cloudMsg.startsWith('Save failed') ? '#dc2626' : '#16a34a' }}>
                      {cloudMsg}
                    </span>
                  )}
                  <button onClick={saveToCloud} disabled={cloudSaving}
                    style={{ fontSize:12, fontWeight:600, padding:'5px 14px',
                      background: cloudSaving ? '#93c5fd' : '#2563eb', color:'white',
                      border:'none', borderRadius:6, cursor: cloudSaving ? 'not-allowed' : 'pointer' }}>
                    {cloudSaving ? 'Saving…' : '☁ Save to cloud'}
                  </button>
                </div>
              )}
            </div>

            {/* Grid or list */}
            {viewMode === 'grid' ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:20 }}>
                {/* New Staff Score card */}
                <button onClick={()=>setWizard(true)}
                  style={{ border:'2px dashed #d1d5db', borderRadius:12, background:'white', cursor:'pointer', padding:0, overflow:'hidden', textAlign:'center', transition:'all 0.15s' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#2563eb';e.currentTarget.style.background='#eff6ff'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white'}}>
                  <div style={{ height:138, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <div style={{ width:44, height:44, borderRadius:'50%', background:'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>♩</div>
                    <span style={{ fontSize:11, fontWeight:600, color:'#2563eb', letterSpacing:'0.05em' }}>STAFF NOTATION</span>
                  </div>
                  <div style={{ padding:'10px 12px 14px', borderTop:'1px solid #f3f4f6', background:'#fafbff' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#1e2433' }}>New Staff Score</div>
                    <div style={{ fontSize:10.5, color:'#6b7280', marginTop:2 }}>Standard music notation</div>
                  </div>
                </button>

                {/* New Solfa Score card */}
                <button onClick={()=>setSolfaWizard(true)}
                  style={{ border:'2px dashed #d1d5db', borderRadius:12, background:'white', cursor:'pointer', padding:0, overflow:'hidden', textAlign:'center', transition:'all 0.15s' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#d97706';e.currentTarget.style.background='#fffbeb'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white'}}>
                  <div style={{ height:138, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <div style={{ width:44, height:44, borderRadius:'50%', background:'#fef3c7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontFamily:'"Times New Roman",serif', fontWeight:700, color:'#92400e' }}>d·r·m</div>
                    <span style={{ fontSize:11, fontWeight:600, color:'#d97706', letterSpacing:'0.05em' }}>TONIC SOL-FA</span>
                  </div>
                  <div style={{ padding:'10px 12px 14px', borderTop:'1px solid #fef3c7', background:'#fffdf0' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#1e2433' }}>New Solfa Score</div>
                    <div style={{ fontSize:10.5, color:'#6b7280', marginTop:2 }}>Choral tonic sol-fa notation</div>
                  </div>
                </button>

                {/* Score cards */}
                {recent.map(({key,score,ts,cloudId})=>(
                  <div key={key} style={{ border:'1px solid #e5e7eb', borderRadius:12, background:'white', overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', transition:'all 0.15s', position:'relative' }}
                    onMouseEnter={e=>e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.12)'}
                    onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)'}>
                    <button onClick={()=>openScore(score, cloudId)} style={{ width:'100%', border:'none', background:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                      <div style={{ height:168, overflow:'hidden', borderBottom:'1px solid #f3f4f6', background:'#fafbfc' }}>
                        <Thumbnail score={score}/>
                      </div>
                      <div style={{ padding:'11px 13px 10px' }}>
                        <div style={{ fontSize:13, fontWeight:600, color:'#1e2433', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {score.title || 'Untitled Score'}
                        </div>
                        <div style={{ fontSize:11, color:'#9ca3af', marginTop:3, display:'flex', alignItems:'center', gap:6 }}>
                          {score?.type === 'solfa' && <span style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:3,background:'#fef3c7',color:'#92400e'}}>SOLFA</span>}
                          {cloudId && <span title="Saved to cloud">☁</span>}
                          {timeAgo(ts)}
                        </div>
                      </div>
                    </button>
                    {cloudId && (
                      <button onClick={()=>deleteCloudScore(cloudId)}
                        title="Delete score"
                        style={{ position:'absolute', top:8, right:8, width:24, height:24, borderRadius:4,
                          background:'rgba(255,255,255,0.9)', border:'1px solid #e5e7eb',
                          cursor:'pointer', fontSize:12, color:'#9ca3af', display:'flex', alignItems:'center', justifyContent:'center' }}
                        onMouseEnter={e=>{e.currentTarget.style.color='#dc2626';e.currentTarget.style.borderColor='#fca5a5'}}
                        onMouseLeave={e=>{e.currentTarget.style.color='#9ca3af';e.currentTarget.style.borderColor='#e5e7eb'}}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}

                {recent.length === 0 && (
                  <div style={{ gridColumn:'1/-1', padding:'48px 0', textAlign:'center', color:'#9ca3af', fontSize:14 }}>
                    No recent scores — click "New score" to create your first one.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {/* New score row in list */}
                {/* New Staff Score */}
                <button onClick={()=>setWizard(true)} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 16px', border:'1px dashed #d1d5db', borderRadius:9, background:'white', cursor:'pointer', transition:'all 0.15s' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#2563eb';e.currentTarget.style.background='#eff6ff'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white'}}>
                  <div style={{ width:38,height:38,borderRadius:8,background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0 }}>♩</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#1e2433' }}>New Staff Score</div>
                    <div style={{ fontSize:11, color:'#6b7280' }}>Standard music notation</div>
                  </div>
                </button>
                {/* New Solfa Score */}
                <button onClick={()=>setSolfaWizard(true)} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 16px', border:'1px dashed #d1d5db', borderRadius:9, background:'white', cursor:'pointer', transition:'all 0.15s' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#d97706';e.currentTarget.style.background='#fffbeb'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white'}}>
                  <div style={{ width:38,height:38,borderRadius:8,background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontFamily:'"Times New Roman",serif',fontWeight:700,color:'#92400e',flexShrink:0 }}>d·r·m</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#1e2433' }}>New Solfa Score</div>
                    <div style={{ fontSize:11, color:'#6b7280' }}>Choral tonic sol-fa notation</div>
                  </div>
                </button>
                {recent.map(({key,score,ts,cloudId})=>(
                  <div key={key} style={{ display:'flex', alignItems:'center', gap:14, padding:'11px 16px', border:'1px solid #e5e7eb', borderRadius:9, background:'white', transition:'all 0.15s', boxShadow:'0 1px 2px rgba(0,0,0,0.05)' }}
                    onMouseEnter={e=>e.currentTarget.style.boxShadow='0 3px 10px rgba(0,0,0,0.09)'}
                    onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.05)'}>
                    <button onClick={()=>openScore(score, cloudId)} style={{ display:'flex', alignItems:'center', gap:14, flex:1, border:'none', background:'none', cursor:'pointer', padding:0, textAlign:'left' }}>
                      <div style={{ width:56,height:42,borderRadius:6,overflow:'hidden',border:'1px solid #e5e7eb',flexShrink:0,background:'#fafbfc' }}><Thumbnail score={score}/></div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13.5,fontWeight:600,color:'#1e2433' }}>{score.title||'Untitled Score'}</div>
                        <div style={{ fontSize:11.5,color:'#9ca3af',marginTop:2 }}>{score.parts?.length||0} parts · {score.parts?.[0]?.measures?.length||0} bars · {cloudId ? '☁ cloud' : 'local'}</div>
                      </div>
                      <div style={{ fontSize:11,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.05em',flexShrink:0 }}>{timeAgo(ts)}</div>
                    </button>
                    {cloudId && (
                      <button onClick={()=>deleteCloudScore(cloudId)}
                        style={{ width:24,height:24,borderRadius:4,background:'none',border:'1px solid #e5e7eb',cursor:'pointer',fontSize:12,color:'#9ca3af',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center' }}
                        onMouseEnter={e=>{e.currentTarget.style.color='#dc2626';e.currentTarget.style.borderColor='#fca5a5'}}
                        onMouseLeave={e=>{e.currentTarget.style.color='#9ca3af';e.currentTarget.style.borderColor='#e5e7eb'}}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, color:'#9ca3af' }}>
            <span style={{ fontSize:48 }}>{NAV.find(n=>n.id===nav)?.icon}</span>
            <div style={{ fontSize:18,fontWeight:600,color:'#374151' }}>{NAV.find(n=>n.id===nav)?.label}</div>
            <div style={{ fontSize:14 }}>Coming soon</div>
          </div>
        )}
      </div>

      {wizard && <Wizard onDone={handleWizardDone} onCancel={()=>setWizard(false)}/>}
      {solfaWizard && <SolfaWizard onDone={handleSolfaWizardDone} onCancel={()=>setSolfaWizard(false)}/>}
    </div>
  )
}