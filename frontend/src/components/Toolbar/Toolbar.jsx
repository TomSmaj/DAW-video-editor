import React, { useState } from 'react'
import useStore from '../../store/useStore'
import ProjectManager from '../ProjectManager/ProjectManager'
import './Toolbar.css'

export default function Toolbar() {
  const {
    bpm, setBpm,
    beatDivision, setBeatDivision,
    snapToGrid, setSnapToGrid,
    zoom, setZoom,
    musicFiles, selectedMusicFile, setSelectedMusicFile,
    currentProjectName,
  } = useStore()

  const [showProjects, setShowProjects] = useState(false)

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
            type="number"
            value={bpm}
            min={20} max={300}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="toolbar-input bpm-input"
          />
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
      </div>

      {showProjects && <ProjectManager onClose={() => setShowProjects(false)} />}
    </>
  )
}
