// src/components/Sidebar/index.jsx
// FaithScore — Sidebar (Palettes / Parts / Layout / Properties)
//
// Layout contract:
//   • The sidebar lives in a normal flex row BELOW the sticky top chrome.
//   • It is NOT position:fixed — that caused it to overlap the toolbar.
//   • It uses `position: sticky; top: 0; height: 100vh - chrome` via
//     `align-self: flex-start` + overflow-y:auto on itself.
//   • The parent (App.jsx) gives it a fixed width; it fills the full
//     remaining height via the flex container being `overflow:hidden`.

import { useState } from 'react'
import { useScoreStore } from '../../store/scoreStore'

const TABS = [
  { id:'palettes',   label:'Palettes'   },
  { id:'parts',      label:'Parts'      },
  { id:'layout',     label:'Layout'     },
  { id:'properties', label:'Properties' },
]

// ── Palette item ─────────────────────────────────────────────────────────────
function PaletteItem({ label, onClick, symbol }) {
  return (
    <button onClick={onClick}
      style={{
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', gap:2,
        width:56, height:52, border:'1px solid #e5e7eb',
        borderRadius:6, background:'white', cursor:'pointer',
        fontSize:11, color:'#374151', transition:'all 0.12s',
        padding:'4px 2px', textAlign:'center', lineHeight:1.2,
      }}
      onMouseEnter={e => { e.currentTarget.style.background='#eff6ff'; e.currentTarget.style.borderColor='#93c5fd' }}
      onMouseLeave={e => { e.currentTarget.style.background='white';   e.currentTarget.style.borderColor='#e5e7eb' }}
    >
      <span style={{ fontSize:18, lineHeight:1 }}>{symbol}</span>
      <span style={{ fontSize:9.5, color:'#6b7280', marginTop:1 }}>{label}</span>
    </button>
  )
}

// ── Palette section (collapsible) ────────────────────────────────────────────
function PaletteSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom:'1px solid #f0f0f0' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'7px 12px', border:'none', background:'none',
          cursor:'pointer', fontSize:11.5, fontWeight:700, color:'#1e2433',
          textAlign:'left', letterSpacing:'0.01em',
        }}
        onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background='none'}
      >
        <span>{title}</span>
        <span style={{ fontSize:10, color:'#9ca3af', transition:'transform 0.15s',
          transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>
      {open && (
        <div style={{
          display:'flex', flexWrap:'wrap', gap:4,
          padding:'4px 10px 10px',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Palettes tab ─────────────────────────────────────────────────────────────
function PalettesTab({ search }) {
  const store = useScoreStore.getState()

  const allPalettes = [
    {
      title:'Clefs', items:[
        { symbol:'𝄞', label:'Treble',     onClick:()=>{} },
        { symbol:'𝄢', label:'Bass',       onClick:()=>{} },
        { symbol:'𝄡', label:'Alto',       onClick:()=>{} },
        { symbol:'𝄡', label:'Tenor',      onClick:()=>{} },
        { symbol:'𝄠', label:'Perc.',      onClick:()=>{} },
      ]
    },
    {
      title:'Key Signatures', items:[
        { symbol:'♮',  label:'C maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(0) },
        { symbol:'♯',  label:'G maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(1) },
        { symbol:'♯♯', label:'D maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(2) },
        { symbol:'♭',  label:'F maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(-1) },
        { symbol:'♭♭', label:'Bb maj',    onClick:()=>useScoreStore.getState().setGlobalKeySignature(-2) },
      ]
    },
    {
      title:'Time Signatures', items:[
        { symbol:'4/4', label:'4/4',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:4,beatType:4}) },
        { symbol:'3/4', label:'3/4',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:3,beatType:4}) },
        { symbol:'2/4', label:'2/4',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:2,beatType:4}) },
        { symbol:'6/8', label:'6/8',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:6,beatType:8}) },
        { symbol:'𝄵',  label:'Cut',   onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:2,beatType:2}) },
        { symbol:'𝄴',  label:'Common',onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:4,beatType:4}) },
      ]
    },
    {
      title:'Dynamics', items:[
        { symbol:'𝆏𝆏𝆏', label:'ppp', onClick:()=>{} },
        { symbol:'𝆏𝆏',  label:'pp',  onClick:()=>{} },
        { symbol:'𝆏',   label:'p',   onClick:()=>{} },
        { symbol:'𝆐𝆏',  label:'mp',  onClick:()=>{} },
        { symbol:'𝆐𝆑',  label:'mf',  onClick:()=>{} },
        { symbol:'𝆑',   label:'f',   onClick:()=>{} },
        { symbol:'𝆑𝆑',  label:'ff',  onClick:()=>{} },
        { symbol:'𝆑𝆑𝆑', label:'fff', onClick:()=>{} },
        { symbol:'sfz', label:'sfz', onClick:()=>{} },
      ]
    },
    {
      title:'Articulations', items:[
        { symbol:'·',  label:'Staccato',   onClick:()=>{} },
        { symbol:'−',  label:'Tenuto',     onClick:()=>{} },
        { symbol:'ˆ',  label:'Marcato',    onClick:()=>{} },
        { symbol:'>',  label:'Accent',     onClick:()=>{} },
        { symbol:'⌢', label:'Slur',       onClick:()=>{} },
        { symbol:'⌣', label:'Tie',        onClick:()=>{} },
        { symbol:'tr', label:'Trill',      onClick:()=>{} },
        { symbol:'~',  label:'Vibrato',    onClick:()=>{} },
      ]
    },
    {
      title:'Text', items:[
        { symbol:'𝄐', label:'Fermata',    onClick:()=>{} },
        { symbol:'D.C', label:'D.C.',     onClick:()=>{} },
        { symbol:'D.S', label:'D.S.',     onClick:()=>{} },
        { symbol:'𝄋', label:'Segno',     onClick:()=>{} },
        { symbol:'𝄌', label:'Coda',      onClick:()=>{} },
        { symbol:'⁋', label:'Fine',      onClick:()=>{} },
      ]
    },
    {
      title:'Barlines', items:[
        { symbol:'|',  label:'Normal',    onClick:()=>{} },
        { symbol:'||', label:'Double',    onClick:()=>{} },
        { symbol:'|‖', label:'Final',    onClick:()=>{} },
        { symbol:'|:',  label:'Repeat S.',onClick:()=>{} },
        { symbol:':|',  label:'Repeat E.',onClick:()=>{} },
        { symbol:':|:', label:'Repeat B.',onClick:()=>{} },
      ]
    },
    {
      title:'Lines', items:[
        { symbol:'cresc.', label:'Cresc.',  onClick:()=>{} },
        { symbol:'dim.',   label:'Dim.',    onClick:()=>{} },
        { symbol:'8va',    label:'8va',     onClick:()=>{} },
        { symbol:'8vb',    label:'8vb',     onClick:()=>{} },
        { symbol:'rit.',   label:'Rit.',    onClick:()=>{} },
        { symbol:'accel.', label:'Accel.',  onClick:()=>{} },
      ]
    },
  ]

  const filtered = search.trim()
    ? allPalettes.map(p => ({
        ...p,
        items: p.items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
      })).filter(p => p.items.length > 0)
    : allPalettes

  return (
    <div>
      {filtered.map((p, i) => (
        <PaletteSection key={p.title} title={p.title} defaultOpen={i < 3}>
          {p.items.map(item => (
            <PaletteItem key={item.label} {...item} />
          ))}
        </PaletteSection>
      ))}
    </div>
  )
}

// ── Parts tab ────────────────────────────────────────────────────────────────
function PartsTab() {
  const score     = useScoreStore(s => s.score)
  const addPart   = useScoreStore(s => s.addPart)
  const removePart= useScoreStore(s => s.removePart)
  const movePartUp= useScoreStore(s => s.movePartUp)
  const movePartDown = useScoreStore(s => s.movePartDown)
  const selectedPartId = useScoreStore(s => s.selectedPartId)
  const setSelectedPart = useScoreStore(s => s.setSelectedPart)

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Voice Parts
      </div>
      {score.parts.map((p, i) => (
        <div key={p.id}
          onClick={() => setSelectedPart?.(p.id)}
          style={{
            display:'flex', alignItems:'center', gap:6, padding:'6px 8px',
            marginBottom:3, borderRadius:6, cursor:'pointer',
            background: selectedPartId === p.id ? '#eff6ff' : 'white',
            border: `1px solid ${selectedPartId === p.id ? '#93c5fd' : '#e5e7eb'}`,
            transition:'all 0.1s',
          }}
        >
          <span style={{ fontSize:15 }}>
            {p.clef === 'bass' ? '𝄢' : '𝄞'}
          </span>
          <span style={{ flex:1, fontSize:12.5, fontWeight:500, color:'#1e2433' }}>
            {p.label || p.name || `Part ${i+1}`}
          </span>
          <div style={{ display:'flex', gap:2 }}>
            <button onClick={e => { e.stopPropagation(); movePartUp(p.id) }}
              style={{ width:18, height:18, border:'none', background:'none', cursor:'pointer',
                fontSize:10, color:'#9ca3af', borderRadius:3 }}
              title="Move up">▲</button>
            <button onClick={e => { e.stopPropagation(); movePartDown(p.id) }}
              style={{ width:18, height:18, border:'none', background:'none', cursor:'pointer',
                fontSize:10, color:'#9ca3af', borderRadius:3 }}
              title="Move down">▼</button>
            <button onClick={e => { e.stopPropagation(); removePart(p.id) }}
              style={{ width:18, height:18, border:'none', background:'none', cursor:'pointer',
                fontSize:11, color:'#f87171', borderRadius:3 }}
              title="Remove part">×</button>
          </div>
        </div>
      ))}
      <button onClick={() => addPart({ label:'New Part', clef:'treble' })}
        style={{
          width:'100%', marginTop:8, padding:'7px 0', fontSize:12, fontWeight:600,
          background:'#eff6ff', color:'#2563eb', border:'1px dashed #93c5fd',
          borderRadius:6, cursor:'pointer',
        }}
        onMouseEnter={e => e.currentTarget.style.background='#dbeafe'}
        onMouseLeave={e => e.currentTarget.style.background='#eff6ff'}
      >
        + Add Part
      </button>
    </div>
  )
}

// ── Layout tab ───────────────────────────────────────────────────────────────
function LayoutTab() {
  const zoom    = useScoreStore(s => s.zoom)
  const setZoom = useScoreStore(s => s.setZoom)

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Layout Options
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:11.5, color:'#374151', marginBottom:4, fontWeight:600 }}>Zoom</div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={() => setZoom(Math.max(0.4, zoom - 0.1))}
            style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
              background:'white', cursor:'pointer', fontSize:14, lineHeight:1 }}>−</button>
          <span style={{ flex:1, textAlign:'center', fontSize:12, fontWeight:600, color:'#1e2433' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
              background:'white', cursor:'pointer', fontSize:14, lineHeight:1 }}>+</button>
        </div>
        <input type="range" min={40} max={200} value={Math.round(zoom*100)}
          onChange={e => setZoom(Number(e.target.value)/100)}
          style={{ width:'100%', marginTop:6, accentColor:'#2563eb' }}
        />
      </div>
      <div style={{ fontSize:11, color:'#9ca3af', lineHeight:1.5 }}>
        More layout options (margins, system spacing, page size) coming soon.
      </div>
    </div>
  )
}

// ── Properties tab ───────────────────────────────────────────────────────────
function PropertiesTab() {
  const liveNote = useScoreStore(s => s.getSelectedNote?.())

  if (!liveNote) {
    return (
      <div style={{ padding:'20px 16px', textAlign:'center' }}>
        <div style={{ fontSize:24, marginBottom:8, color:'#d1d5db' }}>♩</div>
        <div style={{ fontSize:12, color:'#9ca3af', lineHeight:1.5 }}>
          Select a note to see<br/>its properties here
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10,
        textTransform:'uppercase', letterSpacing:'0.05em' }}>Note Properties</div>
      <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#6b7280' }}>Pitch</span>
          <span style={{ fontWeight:600 }}>
            {liveNote.isRest ? 'Rest' : `${liveNote.pitch?.step}${liveNote.pitch?.accidental||''}${liveNote.pitch?.octave}`}
          </span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#6b7280' }}>Duration</span>
          <span style={{ fontWeight:600 }}>
            {liveNote.duration}{liveNote.dots ? '.'.repeat(liveNote.dots) : ''}
          </span>
        </div>
        {liveNote.tie && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#6b7280' }}>Tied</span>
            <span style={{ fontWeight:600, color:'#2563eb' }}>Yes</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Sidebar component ───────────────────────────────────────────────────
export default function Sidebar({ collapsed, setCollapsed }) {
  const [activeTab, setActiveTab] = useState('palettes')
  const [search,    setSearch   ] = useState('')

  if (collapsed) {
    return (
      <div style={{
        width:28, height:'100%', background:'#f9fafb',
        borderRight:'1px solid #e5e7eb',
        display:'flex', flexDirection:'column', alignItems:'center',
        paddingTop:8,
      }}>
        <button onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          style={{ border:'none', background:'none', cursor:'pointer',
            color:'#9ca3af', fontSize:14 }}>›</button>
      </div>
    )
  }

  return (
    <div style={{
      width: 240,
      height: '100%',
      background: '#f9fafb',
      borderRight: '1px solid #e5e7eb',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',   // the child scroll area handles scrolling
      flexShrink: 0,
    }}>

      {/* Tab bar — fixed at top of sidebar */}
      <div style={{
        display:'flex', borderBottom:'1px solid #e5e7eb',
        background:'white', flexShrink:0,
      }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex:1, padding:'7px 0', fontSize:10, fontWeight:700,
              border:'none', background:'none', cursor:'pointer',
              borderBottom: activeTab===tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab===tab.id ? '#2563eb' : '#6b7280',
              letterSpacing:'0.02em',
              transition:'color 0.12s',
            }}
          >{tab.label}</button>
        ))}
        <button onClick={() => setCollapsed(true)} title="Collapse sidebar"
          style={{ width:24, border:'none', background:'none', cursor:'pointer',
            color:'#9ca3af', fontSize:13, flexShrink:0, paddingBottom:2 }}>‹</button>
      </div>

      {/* Search bar — Palettes tab only */}
      {activeTab === 'palettes' && (
        <div style={{ padding:'6px 8px', background:'white',
          borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4,
            background:'#f3f4f6', borderRadius:6, padding:'3px 8px',
            border:'1px solid #e5e7eb' }}>
            <span style={{ color:'#9ca3af', fontSize:11 }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search palettes…"
              style={{ background:'none', border:'none', outline:'none',
                fontSize:11, color:'#374151', width:'100%' }}
            />
          </div>
        </div>
      )}

      {/* Scrollable content area */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'hidden' }}>
        {activeTab==='palettes'   && <PalettesTab   search={search} />}
        {activeTab==='parts'      && <PartsTab />}
        {activeTab==='layout'     && <LayoutTab />}
        {activeTab==='properties' && <PropertiesTab />}
      </div>
    </div>
  )
}