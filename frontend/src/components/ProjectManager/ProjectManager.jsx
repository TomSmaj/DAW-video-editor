import React, { useState, useEffect, useRef } from 'react'
import useStore from '../../store/useStore'
import './ProjectManager.css'

export default function ProjectManager({ onClose }) {
  const { currentProjectId, currentProjectName, setCurrentProject, getProjectState, applyProjectState } = useStore()

  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nameInput, setNameInput] = useState(currentProjectName ?? '')
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const nameRef = useRef(null)

  useEffect(() => {
    nameRef.current?.focus()
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/projects')
      setProjects(await res.json())
    } catch (e) {
      setError('Could not load projects.')
    }
    setLoading(false)
  }

  const handleSave = async () => {
    const name = nameInput.trim()
    if (!name) { nameRef.current?.focus(); return }
    setSaving(true)
    setError(null)
    try {
      const state = getProjectState()
      let res, data

      if (currentProjectId) {
        // Overwrite existing
        res = await fetch(`/api/projects/${currentProjectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, state }),
        })
      } else {
        // Create new
        res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, state }),
        })
      }

      data = await res.json()
      if (data.error) throw new Error(data.error)
      setCurrentProject(data.id, data.name)
      await fetchProjects()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const handleSaveAs = async () => {
    const name = nameInput.trim()
    if (!name) { nameRef.current?.focus(); return }
    setSaving(true)
    setError(null)
    try {
      const state = getProjectState()
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, state }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCurrentProject(data.id, data.name)
      await fetchProjects()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const handleLoad = async (project) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      applyProjectState(data.state)
      setCurrentProject(data.id, data.name)
      setNameInput(data.name)
      onClose()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (currentProjectId === id) setCurrentProject(null, null)
      await fetchProjects()
    } catch (e) {
      setError(e.message)
    }
    setConfirmDelete(null)
  }

  const handleNew = () => {
    applyProjectState({})
    setCurrentProject(null, null)
    setNameInput('')
    onClose()
  }

  const formatDate = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pm-modal">
        <div className="pm-header">
          <span className="pm-title">Projects</span>
          <button className="pm-close" onClick={onClose}>×</button>
        </div>

        {/* Save section */}
        <div className="pm-save-section">
          <input
            ref={nameRef}
            className="pm-name-input"
            placeholder="Project name…"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <div className="pm-save-btns">
            <button className="pm-btn pm-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : currentProjectId ? '💾 Save' : '💾 Save New'}
            </button>
            {currentProjectId && (
              <button className="pm-btn" onClick={handleSaveAs} disabled={saving}>
                Save As…
              </button>
            )}
            <button className="pm-btn pm-btn-new" onClick={handleNew}>
              + New Project
            </button>
          </div>
          {error && <div className="pm-error">{error}</div>}
        </div>

        {/* Project list */}
        <div className="pm-list-header">
          <span>Saved Projects</span>
          <span className="pm-count">{projects.length}</span>
        </div>

        <div className="pm-list">
          {loading && <div className="pm-empty">Loading…</div>}
          {!loading && projects.length === 0 && (
            <div className="pm-empty">No saved projects yet.</div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`pm-item ${p.id === currentProjectId ? 'pm-item-active' : ''}`}
            >
              <button className="pm-item-load" onClick={() => handleLoad(p)}>
                <span className="pm-item-name">{p.name}</span>
                <span className="pm-item-date">{formatDate(p.savedAt)}</span>
              </button>

              {confirmDelete === p.id ? (
                <div className="pm-item-confirm">
                  <span>Delete?</span>
                  <button className="pm-btn pm-btn-danger" onClick={() => handleDelete(p.id)}>Yes</button>
                  <button className="pm-btn" onClick={() => setConfirmDelete(null)}>No</button>
                </div>
              ) : (
                <button
                  className="pm-item-del"
                  onClick={() => setConfirmDelete(p.id)}
                  title="Delete project"
                >🗑</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
