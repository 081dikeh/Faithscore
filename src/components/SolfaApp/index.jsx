// src/components/SolfaApp/index.jsx
// FaithScore — Solfa Editor
//
// HOW INPUT WORKS (duration-based model):
//
// 1. Click any beat on the score to select it (turns blue).
//    Each beat starts as a single rest (blank).
//
// 2. Choose the DURATION of the note you want to enter:
//      ● 4 = whole beat (d)
//      ● 3 = 3/4 beat   (d.,)
//      ● 2 = half beat  (d.)
//      ● 1 = quarter    (d,)
//
// 3. Type a syllable key: d r m f s l t  OR click the syllable button.
//    The note is placed at the current cursor position within the beat.
//    The cursor advances by the note's duration automatically.
//
// 4. If there is space left in the beat, typing another note fills the rest.
//    Example: duration=3 then duration=1 fills a whole beat (3+1=4).
//
// 5. To leave a space (rest): press Space or click ○ Rest.
//    To sustain previous note: press – or click – Hold.
//
// CHANGING AN EXISTING NOTE'S DURATION:
//   Select the event (click it), then press 1/2/3/4 to change its duration.
//   The remaining space in the beat is adjusted automatically.

import { useState, useEffect, useCallback, useRef } from "react";
import * as Tone from "tone";
import SolfaRenderer from "../SolfaRenderer";
import {
  useSolfaStore,
  VOICE_COMBOS,
  migrateMeasure,
} from "../../store/solfaStore";
import { useSolfaPlayback, SOUND_PRESETS } from "../../hooks/useSolfaPlayback";
import { exportSolfaPDF, exportSolfaAudio } from "../../utils/exportSolfa";
import { supabase } from "../../lib/supabase";

const SYLLABLES = ["d", "r", "m", "f", "s", "l", "t"];
const CHROMATIC = ["de", "ri", "fe", "se", "ta"];
const KEYS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
const OCTAVE_LEVELS = [-2, -1, 0, 1, 2];

const TIME_SIGS = [
  { label: "2/4", beats: 2, beatType: 4 },
  { label: "3/4", beats: 3, beatType: 4 },
  { label: "4/4", beats: 4, beatType: 4 },
  { label: "5/4", beats: 5, beatType: 4 },
  { label: "6/4", beats: 6, beatType: 4 },
  { label: "7/4", beats: 7, beatType: 4 },
  { label: "8/4", beats: 8, beatType: 4 },
  { label: "3/8", beats: 3, beatType: 8 },
  { label: "5/8", beats: 5, beatType: 8 },
  { label: "6/8", beats: 6, beatType: 8 },
  { label: "7/8", beats: 7, beatType: 8 },
  { label: "8/8", beats: 8, beatType: 8 },
  { label: "9/8", beats: 9, beatType: 8 },
  { label: "12/8", beats: 12, beatType: 8 },
  { label: "2/2", beats: 2, beatType: 2 },
  { label: "4/2", beats: 4, beatType: 2 },
];

const DUR_LABELS = {
  4: { sym: "d", desc: "Whole beat", hint: "d" },
  3: { sym: "d.‚", desc: "3/4 beat", hint: "d.," },
  2: { sym: "d.", desc: "Half beat", hint: "d." },
  1: { sym: "d,", desc: "Quarter beat", hint: "d," },
};

function OctLabel({ o }) {
  const s = {
    fontFamily: '"Times New Roman",serif',
    fontSize: 13,
    lineHeight: 1,
  };
  if (o === 0) return <span style={s}>d</span>;
  if (o === 1)
    return (
      <span style={s}>
        d<sup style={{ fontSize: 8 }}>1</sup>
      </span>
    );
  if (o === 2)
    return (
      <span style={s}>
        d<sup style={{ fontSize: 8 }}>2</sup>
      </span>
    );
  if (o === -1)
    return (
      <span style={s}>
        d<sub style={{ fontSize: 8 }}>1</sub>
      </span>
    );
  if (o === -2)
    return (
      <span style={s}>
        d<sub style={{ fontSize: 8 }}>2</sub>
      </span>
    );
  return null;
}

export default function SolfaApp({ user, onGoHome }) {
  const score = useSolfaStore((s) => s.score);
  const inputMode = useSolfaStore((s) => s.inputMode);
  const selDuration = useSolfaStore((s) => s.selectedDuration);
  const selOctave = useSolfaStore((s) => s.selectedOctave);
  const selectedPartId = useSolfaStore((s) => s.selectedPartId);
  const selectedMeasureIdx = useSolfaStore((s) => s.selectedMeasureIdx);
  const selectedBeatIdx = useSolfaStore((s) => s.selectedBeatIdx);
  const selectedEventIdx = useSolfaStore((s) => s.selectedEventIdx);

  const setInputMode = useSolfaStore((s) => s.setInputMode);
  const setSelectedDuration = useSolfaStore((s) => s.setSelectedDuration);
  const setTitle = useSolfaStore((s) => s.setTitle);
  const setKey = useSolfaStore((s) => s.setKey);
  const placeEvent = useSolfaStore((s) => s.placeEvent);
  const placeSustain = useSolfaStore((s) => s.placeSustain);
  const changeEventDuration = useSolfaStore((s) => s.changeEventDuration);
  const addMeasure = useSolfaStore((s) => s.addMeasure);
  const deleteMeasure = useSolfaStore((s) => s.deleteMeasure);
  const deleteEvent = useSolfaStore((s) => s.deleteEvent);
  const undo = useSolfaStore((s) => s.undo);
  const selectEvent = useSolfaStore((s) => s.selectEvent);
  const navigateEvent = useSolfaStore((s) => s.navigateEvent);
  const slurStart = useSolfaStore((s) => s.slurStart);
  const clearSlurStart = useSolfaStore((s) => s.clearSlurStart);

  const setOctave = useCallback((o) => {
    useSolfaStore.getState().setSelectedOctave(o);
    const st = useSolfaStore.getState();
    if (
      st.selectedPartId !== null &&
      st.selectedMeasureIdx !== null &&
      st.selectedBeatIdx !== null &&
      st.selectedEventIdx !== null
    ) {
      useSolfaStore
        .getState()
        .changeEventOctave(
          st.selectedPartId,
          st.selectedMeasureIdx,
          st.selectedBeatIdx,
          st.selectedEventIdx,
          o,
        );
    }
  }, []);

  const {
    play,
    pause,
    stop,
    seekToBeat,
    setTempo: setPbTempo,
    toggleMetronome,
    toggleLoop,
    getCurrentSec,
    getTotalSecs,
    getCurrentTempo,
    setPartVolume,
    setPartMute,
    getPartVolume,
    getPartMuted,
    setPreset,
    getPreset,
    onPlaying,
    onBeat,
    isMetronomeOn,
    isLooping,
    isPaused,
  } = useSolfaPlayback();

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackBeat, setPlaybackBeat] = useState(null);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [looping, setLooping] = useState(false);
  const [tempoOverride, setTempoOverride] = useState("");
  const [totalSecs, setTotalSecs] = useState(0);
  const seekBarRef = useRef(null);

  // Subscribe to playback events
  useEffect(() => {
    onPlaying((v) => setIsPlaying(v));
    onBeat((b) => {
      setPlaybackBeat(b);
      setTotalSecs(getTotalSecs());
    });
  }, []);

  const currentSec = getCurrentSec();
  const displayTempo = tempoOverride
    ? Number(tempoOverride)
    : score.tempo || 80;
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [showChromatic, setShowChromatic] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("choir_african");
  const [partVolumes, setPartVolumes] = useState({});
  const [zoom, setZoom] = useState(1.0);

  // Export state
  const rendererRef   = useRef(null);
  const [showExport,  setShowExport]  = useState(false);
  const [exportTab,   setExportTab]   = useState("pdf"); // "pdf" | "audio"
  const [exportBpm,   setExportBpm]   = useState(score.tempo || 80);
  const [exportBusy,  setExportBusy]  = useState(false);
  const [exportProg,  setExportProg]  = useState(0);
  const [exportStatus,setExportStatus]= useState("");

  // ── Get current beat cursor offset ────────────────────────────────────────
  // The cursor within a beat = sum of durations of all events up to and
  // including the selected event. This is where the NEXT note will land.
  function getCursorOffset() {
    if (
      selectedPartId === null ||
      selectedMeasureIdx === null ||
      selectedBeatIdx === null
    )
      return 0;
    const part = score.parts.find((p) => p.id === selectedPartId);
    const beat = migrateMeasure(part?.measures[selectedMeasureIdx])?.beats[
      selectedBeatIdx
    ];
    if (!beat?.events) return 0;
    let offset = 0;
    for (let i = 0; i < beat.events.length; i++) {
      if (i === (selectedEventIdx ?? 0)) return offset;
      offset += beat.events[i].duration;
    }
    return offset;
  }

  // ── Selected event info ────────────────────────────────────────────────────
  const selectedEvent = (() => {
    if (
      selectedPartId === null ||
      selectedMeasureIdx === null ||
      selectedBeatIdx === null ||
      selectedEventIdx === null
    )
      return null;
    const part = score.parts.find((p) => p.id === selectedPartId);
    const beat = migrateMeasure(part?.measures[selectedMeasureIdx])?.beats[
      selectedBeatIdx
    ];
    return beat?.events?.[selectedEventIdx] || null;
  })();
  const dispOct =
    selectedEvent?.type === "note" ? selectedEvent.octave : selOctave;
  const dispDur = selectedEvent ? selectedEvent.duration : selDuration;

  // ── Insert note at current cursor ──────────────────────────────────────────
  function doInsert(syllable) {
    if (
      selectedPartId === null ||
      selectedMeasureIdx === null ||
      selectedBeatIdx === null
    )
      return;
    const offset = getCursorOffset();
    const st = useSolfaStore.getState();
    placeEvent(
      selectedPartId,
      selectedMeasureIdx,
      selectedBeatIdx,
      offset,
      syllable,
      st.selectedDuration,
    );
    // After placing, advance selection to next event
    setTimeout(() => navigateEvent("right"), 0);
  }

  function doRest() {
    if (
      selectedPartId === null ||
      selectedMeasureIdx === null ||
      selectedBeatIdx === null
    )
      return;
    const offset = getCursorOffset();
    const st = useSolfaStore.getState();
    // Place a rest event (type='rest', no syllable)
    placeEvent(
      selectedPartId,
      selectedMeasureIdx,
      selectedBeatIdx,
      offset,
      null,
      st.selectedDuration,
    );
    setTimeout(() => navigateEvent("right"), 0);
  }

  function doSustain() {
    if (
      selectedPartId === null ||
      selectedMeasureIdx === null ||
      selectedBeatIdx === null
    )
      return;
    const offset = getCursorOffset();
    const st = useSolfaStore.getState();
    placeSustain(
      selectedPartId,
      selectedMeasureIdx,
      selectedBeatIdx,
      offset,
      st.selectedDuration,
    );
    setTimeout(() => navigateEvent("right"), 0);
  }

  // Change duration of selected event
  function changeDur(newDur) {
    setSelectedDuration(newDur);
    if (
      selectedPartId !== null &&
      selectedMeasureIdx !== null &&
      selectedBeatIdx !== null &&
      selectedEventIdx !== null
    ) {
      changeEventDuration(
        selectedPartId,
        selectedMeasureIdx,
        selectedBeatIdx,
        selectedEventIdx,
        newDur,
      );
    }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        setInputMode("select");
        clearSlurStart();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        setInputMode("note");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      // Space = play/pause when no beat is selected for note entry
      if (e.key === " " && selectedBeatIdx === null) {
        e.preventDefault();
        isPlaying ? pause() : play();
        return;
      }

      // Duration keys (change toolbar + selected event if any)
      if (e.key === "1") {
        changeDur(1);
        return;
      }
      if (e.key === "2") {
        changeDur(2);
        return;
      }
      if (e.key === "3") {
        changeDur(3);
        return;
      }
      if (e.key === "4") {
        changeDur(4);
        return;
      }

      // Octave
      if (e.key === ",") {
        setOctave(-1);
        return;
      }
      if (e.key === ".") {
        setOctave(0);
        return;
      }
      if (e.key === "'") {
        setOctave(1);
        return;
      }
      if (e.key === "<") {
        setOctave(-2);
        return;
      }
      if (e.key === ">") {
        setOctave(2);
        return;
      }

      // Delete key: remove selected EVENT (replace with rest)
      // Backspace with no event selected: delete the bar
      if (e.key === "Delete") {
        e.preventDefault();
        if (
          selectedPartId !== null &&
          selectedMeasureIdx !== null &&
          selectedBeatIdx !== null &&
          selectedEventIdx !== null
        ) {
          deleteEvent(
            selectedPartId,
            selectedMeasureIdx,
            selectedBeatIdx,
            selectedEventIdx,
          );
        }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        // If an event is selected, delete just that event
        if (
          selectedPartId !== null &&
          selectedMeasureIdx !== null &&
          selectedBeatIdx !== null &&
          selectedEventIdx !== null
        ) {
          deleteEvent(
            selectedPartId,
            selectedMeasureIdx,
            selectedBeatIdx,
            selectedEventIdx,
          );
        } else {
          // Nothing selected — delete the whole bar
          deleteMeasure();
        }
        return;
      }

      // Bar management
      if (e.key === "m" || e.key === "M") {
        addMeasure();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateEvent("right");
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateEvent("left");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateEvent("down");
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateEvent("up");
        return;
      }

      // Note entry (always available if a beat is selected)
      if (selectedBeatIdx !== null) {
        const map = { d: "d", r: "r", m: "m", f: "f", s: "s", l: "l", t: "t" };
        if (map[e.key?.toLowerCase()]) {
          e.preventDefault();
          doInsert(map[e.key.toLowerCase()]);
          return;
        }
        if (e.key === "-") {
          doSustain();
          return;
        }
        if (e.key === " ") {
          e.preventDefault();
          doRest();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    inputMode,
    selectedPartId,
    selectedMeasureIdx,
    selectedBeatIdx,
    selectedEventIdx,
    selDuration,
    isPlaying,
  ]);

  async function saveToCloud() {
    if (!user) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const payload = {
        user_id: user.id,
        title: score.title || "Untitled",
        data: score,
      };
      if (score._cloudId) {
        await supabase
          .from("scores")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", score._cloudId)
          .eq("user_id", user.id);
      } else {
        const { data } = await supabase
          .from("scores")
          .insert([payload])
          .select("id")
          .single();
        if (data?.id) useSolfaStore.getState().setCloudId(data.id);
      }
      setSaveMsg("Saved ✓");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch {
      setSaveMsg("Save failed");
    }
    setSaving(false);
  }

  function formatTime(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  const comboInfo = VOICE_COMBOS[score.voiceCombo] || VOICE_COMBOS.satb;
  const currentTS = `${score.timeSignature?.beats || 4}/${score.timeSignature?.beatType || 4}`;

  const posDisp = (() => {
    if (selectedBeatIdx === null || selectedMeasureIdx === null) return "";
    const part = score.parts.find((p) => p.id === selectedPartId);
    const beat = migrateMeasure(part?.measures[selectedMeasureIdx])?.beats[
      selectedBeatIdx
    ];
    const used = beat?.events?.reduce((s, e) => s + e.duration, 0) || 0;
    const free = 4 - used;
    return `Bar ${selectedMeasureIdx + 1} · Beat ${selectedBeatIdx + 1} · ${free} quarter${free === 1 ? "" : "s"} free`;
  })();

  const Sep = () => (
    <div
      style={{ width: 1, height: 20, background: "#e5e7eb", flexShrink: 0 }}
    />
  );
  const abtn = (active, color = "#2563eb") => ({
    padding: "3px 9px",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    border: `1px solid ${active ? color : "#d1d5db"}`,
    background: active ? color + "18" : "white",
    color: active ? color : "#374151",
    borderRadius: 5,
    cursor: "pointer",
    transition: "all 0.1s",
    whiteSpace: "nowrap",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#f3f4f6",
        fontFamily: "system-ui,sans-serif",
      }}
    >
      {/* ── Menu bar ── */}
      <div
        style={{
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          height: 42,
          padding: "0 12px",
          gap: 8,
          flexShrink: 0,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <button
          onClick={onGoHome}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "3px 8px",
            borderRadius: 5,
            fontWeight: 700,
            fontSize: 13,
            color: "#2563eb",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          <img
            src="/FaithScore_logo.png"
            alt=""
            style={{ height: 20, width: "auto" }}
          />
          FaithScore
        </button>

        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            background: "#fef3c7",
            color: "#92400e",
            letterSpacing: "0.05em",
          }}
        >
          SOLFA · {comboInfo.label}
        </span>
        <Sep />

        <input
          value={score.title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            border: "none",
            borderBottom: "1px solid #d1d5db",
            outline: "none",
            fontSize: 14,
            fontWeight: 600,
            color: "#1e2433",
            width: 180,
            background: "transparent",
          }}
          placeholder="Score title"
        />

        <div style={{ flex: 1 }} />

        {posDisp && (
          <span
            style={{
              fontSize: 10,
              color: "#6b7280",
              fontFamily: "monospace",
              background: "#f3f4f6",
              padding: "2px 7px",
              borderRadius: 3,
            }}
          >
            {posDisp}
          </span>
        )}

        <button
          onClick={undo}
          title="Undo (Ctrl+Z)"
          style={{
            width: 28,
            height: 28,
            border: "1px solid #e5e7eb",
            borderRadius: 5,
            background: "white",
            cursor: "pointer",
            fontSize: 13,
            color: "#6b7280",
          }}
        >
          ↩
        </button>

        <button
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          style={{
            width: 24,
            height: 24,
            border: "1px solid #e5e7eb",
            borderRadius: 4,
            background: "white",
            cursor: "pointer",
            fontSize: 14,
            color: "#6b7280",
          }}
        >
          −
        </button>
        <span
          style={{
            fontSize: 11,
            color: "#9ca3af",
            minWidth: 32,
            textAlign: "center",
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          style={{
            width: 24,
            height: 24,
            border: "1px solid #e5e7eb",
            borderRadius: 4,
            background: "white",
            cursor: "pointer",
            fontSize: 14,
            color: "#6b7280",
          }}
        >
          +
        </button>
        <Sep />

        {saveMsg && (
          <span
            style={{
              fontSize: 11,
              color: saveMsg.includes("fail") ? "#dc2626" : "#16a34a",
            }}
          >
            {saveMsg}
          </span>
        )}

        {/* Export button */}
        <button
          onClick={() => { setExportBpm(score.tempo || 80); setExportStatus(""); setExportProg(0); setShowExport(true); }}
          title="Download PDF or Audio"
          style={{
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "white",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          ⬇ Export
        </button>

        <button
          onClick={saveToCloud}
          disabled={saving || !user}
          style={{
            padding: "4px 14px",
            fontSize: 12,
            fontWeight: 600,
            background: saving ? "#93c5fd" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: saving || !user ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "☁ Save"}
        </button>

        {user && (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#2563eb,#7c3aed)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "white",
            }}
          >
            {(user.user_metadata?.full_name ||
              user.email ||
              "?")[0].toUpperCase()}
          </div>
        )}
      </div>

      {/* ── Input toolbar ── */}
      <div
        style={{
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          padding: "5px 14px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          position: "sticky",
          top: 42,
          zIndex: 45,
        }}
      >
        {/* Mode */}
        <div style={{ display: "flex", gap: 3 }}>
          <button
            style={abtn(inputMode === "select")}
            onClick={() => setInputMode("select")}
            title="Esc"
          >
            ○ Select
          </button>
          <button
            style={abtn(inputMode === "note", "#16a34a")}
            onClick={() => setInputMode("note")}
            title="N"
          >
            ● Note
          </button>
          <button
            style={abtn(inputMode === "slur", "#7c3aed")}
            onClick={() => {
              if (inputMode === "slur") {
                setInputMode("select");
                clearSlurStart();
              } else {
                setInputMode("slur");
              }
            }}
            title="Draw a slur: click first note, then last note. Click slur to delete."
          >
            ⌒ Slur
          </button>
        </div>
        {inputMode === "slur" && (
          <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600, fontStyle: "italic" }}>
            {slurStart ? "Click the ending note →" : "Click the starting note →"}
          </span>
        )}
        <Sep />

        {/* Syllables */}
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {SYLLABLES.map((syl) => (
            <button
              key={syl}
              onClick={() => doInsert(syl)}
              title={`Insert ${syl} (key: ${syl})`}
              style={{
                width: 26,
                height: 26,
                border: "1px solid #d1d5db",
                borderRadius: 4,
                cursor: "pointer",
                background: "white",
                fontSize: 14,
                fontWeight: 600,
                color: "#1e2433",
                fontFamily: '"Times New Roman",serif',
              }}
            >
              {syl}
            </button>
          ))}
          <button
            onClick={() => setShowChromatic((v) => !v)}
            style={{
              padding: "0 7px",
              height: 26,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              cursor: "pointer",
              background: showChromatic ? "#fef3c7" : "white",
              fontSize: 10,
              color: "#6b7280",
            }}
          >
            ♯♭
          </button>
          {showChromatic &&
            CHROMATIC.map((syl) => (
              <button
                key={syl}
                onClick={() => doInsert(syl)}
                style={{
                  padding: "0 7px",
                  height: 26,
                  border: "1px solid #fbbf24",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: "#fef3c7",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#92400e",
                  fontFamily: '"Times New Roman",serif',
                }}
              >
                {syl}
              </button>
            ))}
        </div>
        <Sep />

        <button
          onClick={doRest}
          title="Rest — blank space (Space)"
          style={{ ...abtn(false), padding: "3px 10px" }}
        >
          ○ Rest
        </button>
        <button
          onClick={doSustain}
          title="Hold/sustain dash (key –)"
          style={{
            ...abtn(false),
            padding: "3px 10px",
            fontFamily: '"Times New Roman",serif',
          }}
        >
          – Hold
        </button>
        <Sep />

        {/* Duration — this changes both new notes AND selected existing event */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>
            Duration:
          </span>
          {[4, 3, 2, 1].map((d) => {
            const info = DUR_LABELS[d];
            const active = dispDur === d;
            return (
              <button
                key={d}
                onClick={() => changeDur(d)}
                title={`${info.desc} (key ${d})`}
                style={{
                  ...abtn(active),
                  minWidth: 40,
                  fontFamily: '"Times New Roman",serif',
                  fontSize: 12,
                }}
              >
                <span title={info.desc}>{info.sym}</span>
              </button>
            );
          })}
        </div>
        <Sep />

        {/* Octave */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>Oct:</span>
          {OCTAVE_LEVELS.map((o) => (
            <button
              key={o}
              onClick={() => setOctave(o)}
              style={{
                minWidth: 32,
                height: 28,
                padding: "0 4px",
                border: `1px solid ${dispOct === o ? "#2563eb" : "#d1d5db"}`,
                borderRadius: 4,
                cursor: "pointer",
                background: dispOct === o ? "#eff6ff" : "white",
                color: dispOct === o ? "#2563eb" : "#374151",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <OctLabel o={o} />
            </button>
          ))}
        </div>
        <Sep />

        {/* Key */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#6b7280", fontStyle: "italic" }}>
            Doh=
          </span>
          <select
            value={score.key || "C"}
            onChange={(e) => setKey(e.target.value)}
            style={{
              fontSize: 12,
              border: "1px solid #d1d5db",
              borderRadius: 5,
              padding: "2px 6px",
              background: "white",
              color: "#374151",
            }}
          >
            {KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <Sep />

        {/* Time signature */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>Time:</span>
          <select
            value={currentTS}
            onChange={(e) => {
              const ts = TIME_SIGS.find((t) => t.label === e.target.value);
              if (ts) changeTimeSig(ts.beats, ts.beatType);
            }}
            style={{
              fontSize: 12,
              border: "1px solid #d1d5db",
              borderRadius: 5,
              padding: "2px 6px",
              background: "white",
              color: "#374151",
            }}
          >
            {TIME_SIGS.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <Sep />

        <button
          onClick={addMeasure}
          title="Add bar (M)"
          style={{ ...abtn(false), padding: "3px 9px", fontSize: 11 }}
        >
          + Bar
        </button>
        <button
          onClick={() => deleteMeasure()}
          title="Delete selected bar (− Bar button always deletes bar, not note)"
          style={{
            padding: "3px 9px",
            fontSize: 11,
            fontWeight: 500,
            border: "1px solid #fca5a5",
            borderRadius: 5,
            background: "#fef2f2",
            color: "#dc2626",
            cursor: "pointer",
          }}
        >
          − Bar
        </button>
      </div>

      {/* ── Info bar ── */}
      <div
        style={{
          background: "#f0f9ff",
          borderBottom: "1px solid #bae6fd",
          padding: "3px 14px",
          fontSize: 10,
          color: "#0369a1",
          flexShrink: 0,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span>
          <strong>Duration keys:</strong> 4=whole · 3=¾ beat · 2=half ·
          1=quarter
        </span>
        <span style={{ borderLeft: "1px solid #bae6fd", paddingLeft: 12 }}>
          <strong>To change a note's duration:</strong> click the note → press
          1/2/3/4
        </span>
        <span style={{ borderLeft: "1px solid #bae6fd", paddingLeft: 12 }}>
          <strong>Lyrics:</strong> click the underline below a note
        </span>
        <span style={{ borderLeft: "1px solid #bae6fd", paddingLeft: 12 }}>
          <strong>Keys:</strong> d r m f s l t · – · Space · ← → ↑ ↓ · M=+bar ·
          Del=delete note · ⌫=delete bar
        </span>
      </div>

      {/* ── Transport / Playback bar ── */}
      <div
        style={{
          background: "#1e2433",
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* Play / Pause / Stop */}
        <button
          onClick={() => {
            isPlaying ? pause() : play();
          }}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: isPlaying ? "#f59e0b" : "#22c55e",
            color: "white",
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button
          onClick={stop}
          title="Stop"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "#374151",
            color: "white",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ⏹
        </button>

        {/* Seek bar */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              color: "#9ca3af",
              minWidth: 36,
              fontFamily: "monospace",
            }}
          >
            {formatTime(getCurrentSec())}
          </span>
          <input
            ref={seekBarRef}
            type="range"
            min={0}
            max={Math.max(totalSecs, 1)}
            step={0.1}
            value={Math.min(getCurrentSec(), Math.max(totalSecs, 1))}
            onChange={async (e) => {
              const sec = Number(e.target.value);
              const bpm = displayTempo;
              await seekToBeat(sec / (60 / bpm));
            }}
            style={{
              flex: 1,
              accentColor: "#22c55e",
              height: 4,
              cursor: "pointer",
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: "#9ca3af",
              minWidth: 36,
              fontFamily: "monospace",
            }}
          >
            {formatTime(totalSecs)}
          </span>
        </div>

        {/* Tempo */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#9ca3af" }}>♩=</span>
          <input
            type="number"
            min={20}
            max={300}
            value={tempoOverride || score.tempo || 80}
            onChange={(e) => {
              const v = e.target.value;
              setTempoOverride(v);
              const n = Number(v);
              if (n >= 20 && n <= 300) setPbTempo(n);
            }}
            style={{
              width: 48,
              background: "#374151",
              border: "1px solid #4b5563",
              borderRadius: 4,
              color: "white",
              fontSize: 11,
              textAlign: "center",
              padding: "2px 4px",
              outline: "none",
            }}
          />
        </div>

        {/* Metronome */}
        <button
          onClick={() => {
            const v = toggleMetronome();
            setMetronomeOn(v);
          }}
          title="Toggle metronome"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: metronomeOn ? "#2563eb" : "#374151",
            color: "white",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🎵
        </button>

        {/* Loop */}
        <button
          onClick={() => {
            const v = toggleLoop();
            setLooping(v);
          }}
          title="Loop"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: looping ? "#7c3aed" : "#374151",
            color: "white",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🔁
        </button>

        {/* Preset picker */}
        <select
          value={selectedPreset}
          onChange={async (e) => {
            const id = e.target.value;
            setSelectedPreset(id);
            await setPreset(id);
          }}
          title="Sound preset"
          style={{
            background: "#374151",
            border: "1px solid #4b5563",
            borderRadius: 5,
            color: "white",
            fontSize: 11,
            padding: "3px 6px",
            cursor: "pointer",
            outline: "none",
            maxWidth: 160,
          }}
        >
          {SOUND_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        {/* Mixer toggle */}
        <button
          onClick={() => setShowMixer((v) => !v)}
          title="Part volume mixer"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: showMixer ? "#0891b2" : "#374151",
            color: "white",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🎚
        </button>

        {/* Beat position indicator */}
        {playbackBeat !== null && (
          <span
            style={{
              fontSize: 10,
              color: "#6ee7b7",
              fontFamily: "monospace",
              minWidth: 60,
            }}
          >
            beat {(playbackBeat + 1).toFixed(1)}
          </span>
        )}
      </div>

      {/* ── Mixer panel (per-part volume + preset info) ── */}
      {showMixer && (
        <div
          style={{
            background: "#111827",
            borderBottom: "1px solid #374151",
            padding: "10px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flexShrink: 0,
          }}
        >
          {/* Preset description */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#6ee7b7", fontWeight: 700 }}>
              {SOUND_PRESETS.find((p) => p.id === selectedPreset)?.label}
            </span>
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              {SOUND_PRESETS.find((p) => p.id === selectedPreset)?.desc}
            </span>
          </div>

          {/* Per-part sliders */}
          <div
            style={{
              display: "flex",
              gap: 20,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {(score.parts || []).map((part) => {
              const vol = partVolumes[part.id] ?? 100;
              const muted = vol === 0;
              return (
                <div
                  key={part.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    background: "#1f2937",
                    borderRadius: 8,
                    padding: "8px 10px",
                    minWidth: 64,
                  }}
                >
                  {/* Part label */}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#e5e7eb",
                      fontFamily: '"Times New Roman",serif',
                    }}
                  >
                    {part.label}
                  </span>

                  {/* Vertical volume slider */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={vol}
                    orient="vertical"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPartVolumes((pv) => ({ ...pv, [part.id]: v }));
                      setPartVolume(part.id, v);
                      setPartMute(part.id, v === 0);
                    }}
                    style={{
                      writingMode: "vertical-lr",
                      direction: "rtl",
                      WebkitAppearance: "slider-vertical",
                      width: 28,
                      height: 80,
                      accentColor: muted ? "#dc2626" : "#22c55e",
                      cursor: "pointer",
                    }}
                  />

                  {/* Level % */}
                  <span
                    style={{
                      fontSize: 9,
                      color: muted ? "#dc2626" : "#6ee7b7",
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {muted ? "MUTE" : `${vol}%`}
                  </span>

                  {/* Mute button */}
                  <button
                    onClick={() => {
                      const newVol = muted ? 80 : 0;
                      setPartVolumes((pv) => ({ ...pv, [part.id]: newVol }));
                      setPartVolume(part.id, newVol);
                      setPartMute(part.id, newVol === 0);
                    }}
                    style={{
                      width: 40,
                      height: 20,
                      borderRadius: 4,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 9,
                      fontWeight: 700,
                      background: muted ? "#dc2626" : "#374151",
                      color: "white",
                    }}
                  >
                    {muted ? "UNMUTE" : "MUTE"}
                  </button>
                </div>
              );
            })}

            {/* Master volume */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                background: "#1a2744",
                borderRadius: 8,
                padding: "8px 10px",
                minWidth: 64,
                border: "1px solid #2563eb33",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: "#93c5fd" }}>
                MASTER
              </span>
              <input
                type="range"
                min={-20}
                max={6}
                defaultValue={0}
                orient="vertical"
                onChange={(e) => {
                  Tone.getDestination().volume.value = Number(e.target.value);
                }}
                style={{
                  writingMode: "vertical-lr",
                  direction: "rtl",
                  WebkitAppearance: "slider-vertical",
                  width: 28,
                  height: 80,
                  accentColor: "#3b82f6",
                  cursor: "pointer",
                }}
              />
              <span
                style={{
                  fontSize: 9,
                  color: "#93c5fd",
                  fontFamily: "monospace",
                }}
              >
                VOL
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Score canvas ── */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          background: "#e5e7eb",
          padding: "24px",
        }}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            minHeight: `${1200 * zoom}px`,
          }}
        >
          <div
            style={{
              background: "white",
              maxWidth: 1100,
              margin: "0 auto",
              minHeight: 1200,
              padding: "48px 32px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                textAlign: "center",
                marginBottom: 24,
                paddingBottom: 12,
                borderBottom: "2px solid #1e2433",
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  fontFamily: '"Times New Roman",serif',
                  color: "#111",
                }}
              >
                {score.title || "Untitled Score"}
              </div>
            </div>

            <SolfaRenderer
              ref={rendererRef}
              onSelectEvent={(partId, mIdx, bi, ei) => {
                useSolfaStore.getState().selectEvent(partId, mIdx, bi, ei);
              }}
            />
          </div>
        </div>
      </main>
      {/* ── Export Modal ── */}
      {showExport && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => { if (!exportBusy) setShowExport(false) }}
        >
          <div
            style={{
              background: "white", borderRadius: 12, width: 420,
              boxShadow: "0 8px 40px rgba(0,0,0,0.28)",
              overflow: "hidden",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ background: "#1e2433", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "white", fontWeight: 700, fontSize: 15 }}>⬇ Export Score</span>
              {!exportBusy && (
                <button onClick={() => setShowExport(false)}
                  style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
              {[{id:"pdf",label:"📄 Print / PDF"},{id:"audio",label:"🎵 Audio (WAV)"}].map(tab => (
                <button key={tab.id} onClick={() => !exportBusy && setExportTab(tab.id)}
                  style={{
                    flex:1, padding:"10px 0", fontSize:13, fontWeight: exportTab===tab.id ? 700 : 400,
                    border:"none", borderBottom: exportTab===tab.id ? "2px solid #2563eb" : "2px solid transparent",
                    background: exportTab===tab.id ? "#eff6ff" : "white",
                    color: exportTab===tab.id ? "#2563eb" : "#6b7280",
                    cursor: exportBusy ? "not-allowed" : "pointer",
                  }}
                >{tab.label}</button>
              ))}
            </div>

            {/* Body */}
            <div style={{ padding: "20px 24px 24px" }}>
              {exportTab === "pdf" ? (
                <div>
                  <p style={{ fontSize: 13, color: "#374151", marginBottom: 16, lineHeight: 1.5 }}>
                    Opens a print-ready page with your solfa score laid out on A4.
                    Use <strong>File → Print</strong> or <strong>Save as PDF</strong> in the print dialog.
                  </p>
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 18, fontSize: 12, color: "#64748b" }}>
                    <div>📐 A4 portrait format</div>
                    <div>🎼 Includes title, key, time signature &amp; tempo</div>
                    <div>🖋 All voice parts included</div>
                  </div>
                  <button
                    onClick={() => {
                      const svgEl = rendererRef.current?.getSvgElement()
                      exportSolfaPDF(score, svgEl)
                    }}
                    style={{
                      width: "100%", padding: "11px 0", fontSize: 14, fontWeight: 700,
                      background: "#2563eb", color: "white", border: "none",
                      borderRadius: 8, cursor: "pointer",
                    }}
                  >
                    Open Print Preview →
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "#374151", marginBottom: 14, lineHeight: 1.5 }}>
                    Renders your score to a <strong>WAV audio file</strong> using the choir sampler,
                    at any BPM you choose.
                  </p>

                  {/* BPM picker */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                    <label style={{ fontSize: 12, color: "#6b7280", minWidth: 60 }}>♩ = BPM</label>
                    <input type="range" min={20} max={240} value={exportBpm}
                      onChange={e => setExportBpm(Number(e.target.value))}
                      disabled={exportBusy}
                      style={{ flex: 1, accentColor: "#2563eb" }}
                    />
                    <input type="number" min={20} max={240} value={exportBpm}
                      onChange={e => setExportBpm(Math.max(20, Math.min(240, Number(e.target.value))))}
                      disabled={exportBusy}
                      style={{ width: 56, padding: "3px 6px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 5, textAlign: "center" }}
                    />
                  </div>

                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 18, fontSize: 12, color: "#64748b" }}>
                    <div>🎤 FluidR3 Choir Aahs sampler — all SATB parts</div>
                    <div>🔊 44.1 kHz stereo WAV with reverb</div>
                    <div>⚡ Rendered offline (faster than real-time)</div>
                  </div>

                  {/* Progress */}
                  {exportBusy && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{exportStatus}</div>
                      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round(exportProg * 100)}%`, background: "#2563eb", borderRadius: 3, transition: "width 0.2s" }} />
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>{Math.round(exportProg * 100)}%</div>
                    </div>
                  )}

                  {exportStatus && !exportBusy && (
                    <div style={{ fontSize: 13, color: exportStatus.includes("✓") ? "#16a34a" : "#dc2626", marginBottom: 12, fontWeight: 600 }}>
                      {exportStatus}
                    </div>
                  )}

                  <button
                    disabled={exportBusy}
                    onClick={async () => {
                      setExportBusy(true)
                      setExportProg(0)
                      setExportStatus("")
                      try {
                        await exportSolfaAudio(score, {
                          tempo: exportBpm,
                          onProgress: p => setExportProg(p),
                          onStatus:   s => setExportStatus(s),
                        })
                      } catch(err) {
                        setExportStatus("Export failed: " + (err?.message || err))
                      }
                      setExportBusy(false)
                    }}
                    style={{
                      width: "100%", padding: "11px 0", fontSize: 14, fontWeight: 700,
                      background: exportBusy ? "#93c5fd" : "#2563eb", color: "white",
                      border: "none", borderRadius: 8,
                      cursor: exportBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {exportBusy ? "Rendering…" : "⬇ Download WAV"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}