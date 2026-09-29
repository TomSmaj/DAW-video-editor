import React, { useEffect, useState } from 'react'
import './LogsView.css'

const formatTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

export default function LogsView({ onBack }) {
  const [entries, setEntries] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/logs')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setEntries(data.entries)
      setTruncated(data.truncated)
    } catch (e) {
      setError('Could not load logs: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="logs-view">
      <div className="logs-header">
        <button className="logs-btn" onClick={onBack}>← Back to editor</button>
        <span className="logs-title">Logs</span>
        <span className="logs-count">
          {loading ? 'loading…' : `${entries.length} entries, newest first${truncated ? ' (older entries omitted)' : ''}`}
        </span>
        <span className="logs-spacer" />
        <button className="logs-btn" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="logs-error">{error}</div>}

      <div className="logs-list">
        {!loading && !error && entries.length === 0 && (
          <div className="logs-empty">No log entries yet.</div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`logs-row logs-${e.level}`}>
            <span className="logs-time">{formatTime(e.time)}</span>
            <span className="logs-msg">
              {e.msg}
              {e.detail && <span className="logs-detail"> — {e.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
