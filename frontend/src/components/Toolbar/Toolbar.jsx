import React, { useState, useEffect, useRef } from 'react'
import useStore from '../../store/useStore'
import { detectBpm } from '../../utils/bpmDetect'
import ProjectManager from '../ProjectManager/ProjectManager'
import './Toolbar.css'

const clampBpm = (n) => Math.min(300, Math.max(20, n))

// Taps further apart than this start a new tap-tempo sequence
const TAP_RESET_MS = 2000
const TAP_WINDOW = 8

export default function Toolbar() {
  const {
    bpm, setBpm,
    beatDivision, setBeatDivision,
    snapToGrid, setSnapToGrid,
    zoom, setZoom,
    musicFiles, selectedMusicFile, setSelectedMusicFile,
    currentProjectName, pushHistory, setMusicOffsetBeats,
  } = useStore()

  const [showProjects, setShowProjects] = useState(false)
  const [bpmDraft, setBpmDraft] = useState(String(bpm))

  // Resync the draft when bpm changes outside this input, e.g. loading a project
  useEffect(() => { setBpmDraft(String(bpm)) }, [bpm])

  // ── BPM detection ───────────────────────────────────────────────────────
  const [detecting, setDetecting] = useState(false)
  const [suggestion, setSuggestion] = useState(null) // { file, bpm, offset }
  const [detectError, setDetectError] = useState(null)

  // A suggestion only makes sense for the song it was detected from
  useEffect(() => {
    setSuggestion(null)
    setDetectError(null)
  }, [selectedMusicFile])

  const handleDetect = async () => {
    const file = selectedMusicFile
    if (!file) return
    setDetecting(true)
    setDetectError(null)
    setSuggestion(null)
    try {
      const result = await detectBpm(file)
      // Ignore a result that lands after the user switched songs
      if (useStore.getState().selectedMusicFile === file) setSuggestion({ file, ...result })
    } catch (err) {
      setDetectError('No beat found')
    }
    setDetecting(false)
  }

  // Sets the BPM and nudges the song by under half a beat so its first detected
  // beat lands on a grid line, leaving it otherwise where the user placed it
  const applySuggestion = () => {
    const { bpm: oldBpm, musicOffsetBeats } = useStore.getState()
    const newBpm = clampBpm(suggestion.bpm)
    const songStartSec = musicOffsetBeats * (60 / oldBpm)
    const firstBeat = (songStartSec + suggestion.offset) * (newBpm / 60)
    const newOffset = Math.round(firstBeat) - suggestion.offset * (newBpm / 60)

    pushHistory()
    setBpm(newBpm)
    setMusicOffsetBeats(Math.round(newOffset * 10000) / 10000)
    setSuggestion(null)
  }

  // ×2 / ÷2 for half/double-tempo mistakes. The song offset scales with it so
  // the song stays at the same point in time and its beats stay on the grid.
  const scaleBpm = (factor) => {
    const { bpm: oldBpm, musicOffsetBeats } = useStore.getState()
    const newBpm = clampBpm(oldBpm * factor)
    if (newBpm === oldBpm) return
    pushHistory()
    setBpm(newBpm)
    setMusicOffsetBeats(musicOffsetBeats * (newBpm / oldBpm))
  }

  // ── Tap tempo ───────────────────────────────────────────────────────────
  const taps = useRef([])
  const tapResetTimer = useRef(null)
  const [tapCount, setTapCount] = useState(0)

  useEffect(() => () => clearTimeout(tapResetTimer.current), [])

  const handleTap = () => {
    const now = performance.now()
    const prev = taps.current
    if (prev.length && now - prev[prev.length - 1] > TAP_RESET_MS) taps.current = []
    taps.current = [...taps.current, now].slice(-TAP_WINDOW)
    const t = taps.current
    setTapCount(t.length)

    clearTimeout(tapResetTimer.current)
    tapResetTimer.current = setTimeout(() => { taps.current = []; setTapCount(0) }, TAP_RESET_MS)

    if (t.length < 2) return
    const avgMs = (t[t.length - 1] - t[0]) / (t.length - 1)
    const tapped = clampBpm(Math.round((60000 / avgMs) * 10) / 10)
    // One undo step per tap sequence, not per tap
    if (t.length === 2) pushHistory()
    setBpm(tapped)
  }

  const commitBpm = (raw) => {
    const n = parseFloat(raw)
    const clamped = !isNaN(n) ? Math.min(300, Math.max(20, n)) : bpm
    // Blurring without a real change shouldn't consume an undo step
    if (clamped !== bpm) pushHistory()
    setBpm(clamped)
    setBpmDraft(String(clamped))
  }

  return (
    <>
      <div className="toolbar">
        <button className="toolbar-brand" onClick={() => setShowProjects(true)} title="Open Projects">
          MVE
        </button>

        <div className="toolbar-sep" />

        <button
          className="toolbar-project-btn"
          onClick={() => setShowProjects(true)}
          title="Save / Load project"
        >
          {currentProjectName ? (
            <>💾 <span className="toolbar-project-name">{currentProjectName}</span></>
          ) : (
            '💾 Projects'
          )}
        </button>

        <div className="toolbar-sep" />

        <div className="toolbar-group">
          <label className="toolbar-label">BPM</label>
          <input
            type="text"
            inputMode="decimal"
            value={bpmDraft}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={(e) => commitBpm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.target.blur() }
              if (e.key === 'Escape') { setBpmDraft(String(bpm)); e.target.blur() }
            }}
            onFocus={(e) => e.target.select()}
            className="toolbar-input bpm-input"
          />
          <button className="toolbar-mini-btn" onClick={() => scaleBpm(0.5)} title="Halve BPM">÷2</button>
          <button className="toolbar-mini-btn" onClick={() => scaleBpm(2)} title="Double BPM">×2</button>
          <button
            className={`toolbar-mini-btn${tapCount > 0 ? ' tapping' : ''}`}
            onClick={handleTap}
            title="Tap along with the beat to set BPM"
          >
            {tapCount > 0 ? `Tap ${tapCount}` : 'Tap'}
          </button>
          <button
            className="toolbar-mini-btn"
            onClick={handleDetect}
            disabled={!selectedMusicFile || detecting}
            title={selectedMusicFile ? 'Detect BPM from the selected song' : 'Select a song to detect its BPM'}
          >
            {detecting ? 'Detecting…' : 'Detect'}
          </button>
          {suggestion && (
            <span className="bpm-suggestion">
              ≈ {suggestion.bpm} BPM
              <button
                className="toolbar-mini-btn apply"
                onClick={applySuggestion}
                title="Set BPM and nudge the song so its beats line up with the grid"
              >Apply</button>
              <button className="toolbar-mini-btn" onClick={() => setSuggestion(null)} title="Dismiss">✕</button>
            </span>
          )}
          {detectError && <span className="bpm-detect-error">{detectError}</span>}
        </div>

        <div className="toolbar-sep" />

        <div className="toolbar-group">
          <label className="toolbar-label">Grid</label>
          <select
            value={beatDivision}
            onChange={(e) => setBeatDivision(e.target.value)}
            className="toolbar-select"
          >
            <option value="whole">Whole</option>
            <option value="half">Half</option>
            <option value="quarter">Quarter</option>
            <option value="eighth">Eighth</option>
            <option value="sixteenth">Sixteenth</option>
          </select>
        </div>

        <div className="toolbar-group">
          <label className="toolbar-label snap-label">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => setSnapToGrid(e.target.checked)}
              className="snap-checkbox"
            />
            Snap
          </label>
        </div>

        <div className="toolbar-sep" />

        <div className="toolbar-group">
          <label className="toolbar-label">Zoom</label>
          <input
            type="range"
            min={0.25} max={4} step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="toolbar-range"
          />
          <span className="toolbar-value">{zoom}x</span>
        </div>

        <div className="toolbar-sep" />

        <div className="toolbar-group">
          <label className="toolbar-label">Music</label>
          <select
            value={selectedMusicFile ?? ''}
            onChange={(e) => setSelectedMusicFile(e.target.value || null)}
            className="toolbar-select music-select"
          >
            <option value="">— None —</option>
            {musicFiles.map((f) => (
              <option key={f.id} value={f.filename}>{f.filename}</option>
            ))}
          </select>
        </div>

        <span className="toolbar-spacer" />

        <button
          className="toolbar-project-btn"
          onClick={() => { window.location.hash = '#/logs' }}
          title="View application logs"
        >
          Logs
        </button>
      </div>

      {showProjects && <ProjectManager onClose={() => setShowProjects(false)} />}
    </>
  )
}
