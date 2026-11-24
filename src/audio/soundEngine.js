// src/audio/soundEngine.js
// FaithScore's sound engine: real instrument sounds (a General MIDI sound bank —
// the same family MuseScore uses by default), rendered in the background one
// stem per part, played through a live mixer.
//
//   score events ──► worker (SoundFont synth) ──► 20 s windows of per-part audio
//        ──► Web Audio: per-part gain / pan / reverb send ──► master ──► speakers
//
// Mixer changes (volume, pan, mute, solo, reverb) act on the stems' gain nodes
// and are instant. Changing instruments or notes needs a re-render (automatic).
import * as Tone from 'tone'
import { getInstrument } from './instruments.js'
import { LOUDNESS_TRIMS } from './loudnessTrims.js'

const WINDOW_SECS = 20            // how much score is rendered per window
const SCHEDULE_AHEAD = 14         // keep this many seconds rendered/scheduled in front of the playhead
const SF_CACHE = 'faithscore-soundfont-v1'
const SF_FILE = 'FluidR3Mono_GM.sf3'
const SF_GITHUB =
  'https://raw.githubusercontent.com/musescore/MuseScore/main/share/sound/FluidR3Mono_GM.sf3'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function soundfontUrls() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
  const base = env.BASE_URL || '/'
  return [env.VITE_SOUNDFONT_URL, `${base}soundfonts/${SF_FILE}`, SF_GITHUB].filter(Boolean)
}

// Download the sound bank once, keep it in the browser's cache afterwards.
async function fetchSoundfont(onProgress) {
  const urls = soundfontUrls()
  let cache = null
  try { cache = await caches.open(SF_CACHE) } catch (_) {}
  for (const url of urls) {
    try {
      const hit = cache && (await cache.match(url))
      if (hit) { onProgress?.({ loaded: 1, total: 1, cached: true }); return await hit.arrayBuffer() }
    } catch (_) {}
  }
  let lastErr = null
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || 0
      const reader = res.clone().body?.getReader()
      const chunks = []
      let loaded = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value); loaded += value.length
          onProgress?.({ loaded, total, cached: false })
        }
      }
      try { cache && (await cache.put(url, res.clone())) } catch (_) {}
      const buf = await res.arrayBuffer()
      if (buf.byteLength < 1_000_000) throw new Error('not a sound bank')
      return buf
    } catch (e) { lastErr = e }
  }
  throw new Error(`Could not load the instrument sounds (${lastErr?.message || 'offline?'})`)
}

// A cheap fingerprint of the events, to know when audio must be re-rendered.
function fingerprint(tracks) {
  let h = 2166136261
  const mix = (n) => { h ^= Math.round(n * 1000) | 0; h = Math.imul(h, 16777619) }
  for (const t of tracks) {
    for (const c of t.instrumentId) mix(c.charCodeAt(0))
    for (const e of t.events) { mix(e.t); mix(e.d); mix(e.midi); mix(e.vel) }
  }
  return h >>> 0
}

class SoundEngine {
  constructor() {
    this.ctx = null
    this.worker = null
    this.bank = null               // main-thread fallback only
    this.readyPromise = null
    this.status = 'idle'           // idle | loading | ready | error
    this.statusInfo = null
    this.listeners = new Set()

    this.tracks = new Map()        // partId -> { node graph + mix }
    this.spec = null               // { tracks:[{id,instrumentId,events,...}], total }
    this.specKey = 0
    this.chunks = new Map()        // window index -> Promise<{start,len,buffers:{id:AudioBuffer}}>
    this.job = 0
    this.pending = new Map()       // job -> {resolve,reject}

    this.playing = false
    this.t0 = 0                    // ctx time that corresponds to `offset`
    this.offset = 0
    this.pausedAt = 0
    this.sources = new Set()
    this.timer = null
    this.scheduledUntil = 0
    this.token = 0
    this.master = 100
    this.loop = null
  }

  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  _setStatus(status, info) {
    this.status = status; this.statusInfo = info || null
    this.listeners.forEach((fn) => { try { fn(status, info) } catch (_) {} })
  }

  // ── set-up ───────────────────────────────────────────────────────────────
  _ensureContext() {
    if (this.ctx) return this.ctx
    const ctx = Tone.getContext().rawContext
    this.ctx = ctx
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = this.master / 100
    // a gentle limiter, so four loud parts together never clip
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -10
    this.limiter.knee.value = 8
    this.limiter.ratio.value = 6
    this.limiter.attack.value = 0.004
    this.limiter.release.value = 0.2
    this.masterGain.connect(this.limiter)
    this.limiter.connect(ctx.destination)
    // shared reverb bus (a generated room, no impulse file to download)
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this._makeImpulse(ctx, 2.2)
    this.reverbOut = ctx.createGain()
    this.reverbOut.gain.value = 0.7
    this.reverb.connect(this.reverbOut)
    this.reverbOut.connect(this.masterGain)
    return ctx
  }

  _makeImpulse(ctx, secs) {
    const sr = ctx.sampleRate
    const len = Math.floor(sr * secs)
    const buf = ctx.createBuffer(2, len, sr)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      let seed = 12345 + c * 777
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
      for (let i = 0; i < len; i++) {
        const t = i / sr
        // fast-fading early reflections into a smooth exponential tail, darker as it decays
        d[i] = rnd() * Math.exp(-t * 2.9) * (i < sr * 0.03 ? i / (sr * 0.03) : 1)
      }
      let lp = 0
      for (let i = 0; i < len; i++) { lp += (d[i] - lp) * (0.55 - 0.4 * (i / len)); d[i] = lp }
    }
    return buf
  }

  // Load the sound bank and start the render worker. Safe to call repeatedly.
  ready() {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = (async () => {
      this._setStatus('loading', { stage: 'download', loaded: 0, total: 0 })
      try {
        const sf = await fetchSoundfont((p) => this._setStatus('loading', { stage: 'download', ...p }))
        this._setStatus('loading', { stage: 'prepare' })
        await this._startWorker(sf)
        this._setStatus('ready')
        return true
      } catch (e) {
        this.readyPromise = null
        this._setStatus('error', { message: String(e?.message || e) })
        return false
      }
    })()
    return this.readyPromise
  }

  async _startWorker(sf) {
    let worker = null
    try {
      worker = new Worker(new URL('./soundWorker.js', import.meta.url), { type: 'module' })
    } catch (_) { worker = null }
    if (worker) {
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('sound worker did not start')), 20000)
          worker.onmessage = (ev) => {
            if (ev.data.type === 'ready') { clearTimeout(timer); resolve() }
            else if (ev.data.type === 'error') { clearTimeout(timer); reject(new Error(ev.data.message)) }
          }
          worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'sound worker failed')) }
          // send a COPY: the worker takes the buffer, and we keep ours in case it fails
          const copy = sf.slice(0)
          worker.postMessage({ type: 'init', soundfont: copy }, [copy])
        })
        worker.onmessage = (ev) => this._onWorker(ev.data)
        // if the worker dies later, fail the renders waiting on it instead of hanging
        worker.onerror = (e) => this._failPending(new Error(e.message || 'sound worker failed'))
        this.worker = worker
        return
      } catch (_) {
        try { worker.terminate() } catch (__) {}
        worker = null
      }
    }
    // No (working) Worker — e.g. a restricted desktop/webview setup: render on the
    // main thread instead. Same sound, just less smooth while it renders.
    const core = await import('./renderCore.js')
    this.core = core
    this.bank = core.parseSoundBank(sf)
  }

  _failPending(err) {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  _onWorker(m) {
    const p = this.pending.get(m.job)
    if (!p) return
    this.pending.delete(m.job)
    if (m.type === 'done') p.resolve(m)
    else if (m.type === 'cancelled') p.resolve(null)
    else p.reject(new Error(m.message || 'render failed'))
  }

  // ── tracks / mixer ───────────────────────────────────────────────────────
  // spec: { tracks:[{ id, instrumentId, events:[{t,d,midi,vel}] }], total }
  setScore(spec) {
    this._ensureContext()
    const tracks = spec.tracks.map((t) => {
      const inst = getInstrument(t.instrumentId)
      return {
        id: t.id,
        instrumentId: inst.id,
        program: inst.program,
        unpitched: inst.unpitched,
        drumKey: inst.drum,
        drumLow: inst.drumLow ?? null,
        vib: inst.vib,
        gainDb: LOUDNESS_TRIMS[inst.id] ?? 0,
        events: t.events,
        base: { pan: t.pan ?? inst.pan, reverb: inst.reverb },
      }
    })
    const key = fingerprint(tracks)
    const changed = key !== this.specKey
    this.spec = { tracks, total: spec.total }
    if (changed) { this.specKey = key; this.chunks.clear() }
    // build / drop the per-part audio graph
    const keep = new Set(tracks.map((t) => t.id))
    for (const [id, g] of this.tracks) {
      if (!keep.has(id)) { try { g.input.disconnect() } catch (_) {} this.tracks.delete(id) }
    }
    for (const t of tracks) {
      let g = this.tracks.get(t.id)
      if (!g) {
        const ctx = this.ctx
        const input = ctx.createGain()
        const pan = ctx.createStereoPanner()
        const send = ctx.createGain()
        input.connect(pan); pan.connect(this.masterGain)
        input.connect(send); send.connect(this.reverb)
        g = { input, pan, send, mix: { volume: 100, pan: 0, mute: false, solo: false, reverb: 100 } }
        this.tracks.set(t.id, g)
      }
      g.base = t.base
    }
    this._applyMixer()
    return changed
  }

  setPartMix(partId, patch) {
    const g = this.tracks.get(partId)
    if (!g) { this.pendingMix = { ...(this.pendingMix || {}), [partId]: { ...(this.pendingMix?.[partId] || {}), ...patch } }; return }
    Object.assign(g.mix, patch)
    this._applyMixer()
  }
  getPartMix(partId) { return { ...(this.tracks.get(partId)?.mix || { volume: 100, pan: 0, mute: false, solo: false, reverb: 100 }) } }

  setMasterVolume(pct) {
    this.master = clamp(pct, 0, 100)
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.master / 100, this.ctx.currentTime, 0.02)
  }

  _applyMixer() {
    if (this.pendingMix) {
      for (const [id, p] of Object.entries(this.pendingMix)) { const g = this.tracks.get(id); if (g) Object.assign(g.mix, p) }
      this.pendingMix = null
    }
    const anySolo = [...this.tracks.values()].some((g) => g.mix.solo)
    const now = this.ctx.currentTime
    for (const g of this.tracks.values()) {
      const audible = !g.mix.mute && (!anySolo || g.mix.solo)
      const vol = audible ? Math.pow(clamp(g.mix.volume, 0, 100) / 100, 1.6) : 0
      g.input.gain.setTargetAtTime(vol, now, 0.015)
      g.pan.pan.setTargetAtTime(clamp((g.base?.pan || 0) + g.mix.pan / 100, -1, 1), now, 0.015)
      g.send.gain.setTargetAtTime(clamp((g.base?.reverb ?? 0.18) * (g.mix.reverb / 100), 0, 1), now, 0.015)
    }
  }

  // ── rendering windows ────────────────────────────────────────────────────
  _renderChunk(index) {
    if (this.chunks.has(index)) return this.chunks.get(index)
    const start = index * WINDOW_SECS
    const end = start + WINDOW_SECS
    const specKey = this.specKey
    const spec = this.spec
    const promise = (async () => {
      const payload = spec.tracks.map((t) => ({
        id: t.id, program: t.program, unpitched: t.unpitched, drumKey: t.drumKey, drumLow: t.drumLow,
        vib: t.vib, gainDb: t.gainDb, events: t.events,
      }))
      let res
      if (this.worker) {
        const job = ++this.job
        res = await new Promise((resolve, reject) => {
          this.pending.set(job, { resolve, reject })
          this.worker.postMessage({ type: 'render', job, tracks: payload, start, end })
        })
      } else {
        res = await this.core.renderWindow(this.bank, payload, start, end)
      }
      if (!res || specKey !== this.specKey) return null   // superseded by an edit
      const buffers = {}
      for (const s of res.stems) {
        const buf = this.ctx.createBuffer(1, res.length, res.sampleRate)
        buf.copyToChannel(s.data, 0)
        buffers[s.id] = buf
      }
      return { start, len: res.length / res.sampleRate, buffers }
    })()
    this.chunks.set(index, promise)
    promise.then((r) => { if (!r) this.chunks.delete(index) }, () => this.chunks.delete(index))
    return promise
  }

  _scheduleChunk(chunk, token) {
    if (!chunk || token !== this.token) return
    const ctx = this.ctx
    const now = ctx.currentTime
    for (const [id, buffer] of Object.entries(chunk.buffers)) {
      const g = this.tracks.get(id)
      if (!g) continue
      let when = this.t0 + (chunk.start - this.offset)
      let into = 0
      if (when < now) { into = now - when; when = now }
      if (into >= buffer.duration) continue
      const src = this.ctx.createBufferSource()
      src.buffer = buffer
      src.connect(g.input)
      src.onended = () => this.sources.delete(src)
      src.start(when, into)
      this.sources.add(src)
    }
  }

  // ── transport ────────────────────────────────────────────────────────────
  now() { return this.ctx ? this.ctx.currentTime : Tone.now() }
  isPlaying() { return this.playing }
  getPosition() {
    return this.playing ? this.offset + (this.ctx.currentTime - this.t0) : this.pausedAt
  }

  // Start playing `fromSec` seconds into the score. Resolves once audio is
  // running, with the context time at which `fromSec` is heard.
  async play(fromSec = 0, { lead = 0.12 } = {}) {
    if (!this.spec) return null
    this._ensureContext()
    if (this.ctx.state !== 'running') { try { await this.ctx.resume() } catch (_) {} }
    this._stopSources()
    const token = ++this.token
    this.playing = false
    const first = Math.floor(fromSec / WINDOW_SECS)
    let chunk
    try {
      chunk = await this._renderChunk(first)
    } catch (e) {
      // rendering failed: report it so the caller can fall back to the basic sound
      this._setStatus('error', { message: String(e?.message || e) })
      return null
    }
    if (token !== this.token) return null
    if (!chunk) return null
    this.offset = fromSec
    this.t0 = this.ctx.currentTime + lead
    this.playing = true
    this.pausedAt = fromSec
    this.scheduledUntil = chunk.start + chunk.len
    this._scheduleChunk(chunk, token)
    this._startPump(token)
    return this.t0
  }

  _startPump(token) {
    clearInterval(this.timer)
    this.timer = setInterval(async () => {
      if (token !== this.token || !this.playing) return
      const pos = this.getPosition()
      if (this.spec && pos >= this.spec.total + 2) return
      if (this.scheduledUntil - pos < SCHEDULE_AHEAD && this.scheduledUntil < this.spec.total + 1 && !this._pumping) {
        this._pumping = true
        try {
          const idx = Math.floor(this.scheduledUntil / WINDOW_SECS + 1e-6)
          const chunk = await this._renderChunk(idx)
          if (token === this.token && chunk) {
            this._scheduleChunk(chunk, token)
            this.scheduledUntil = chunk.start + chunk.len
          }
        } finally { this._pumping = false }
      }
    }, 250)
  }

  _stopSources() {
    for (const s of this.sources) { try { s.onended = null; s.stop() } catch (_) {} }
    this.sources.clear()
    clearInterval(this.timer)
    this.timer = null
  }

  pause() {
    if (!this.playing) return
    this.pausedAt = this.getPosition()
    this.token++
    this.playing = false
    this._stopSources()
  }

  async resume() { return this.play(this.pausedAt) }

  stop() {
    this.token++
    this.playing = false
    this.pausedAt = 0
    this._stopSources()
  }

  // Drop rendered audio (e.g. after the user changes an instrument).
  invalidate() { this.chunks.clear(); this.specKey = 0 }
}

export const soundEngine = new SoundEngine()
export { WINDOW_SECS }