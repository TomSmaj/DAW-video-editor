import React from 'react'
import useStore from '../../store/useStore'
import './ClipLibrary.css'

export default function ClipLibrary() {
  const libraryClips = useStore((s) => s.libraryClips)

  const handleDragStart = (e, clip) => {
    e.dataTransfer.setData('clipId', clip.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="clip-library">
      <div className="panel-header">Clips ({libraryClips.length})</div>
      <div className="clip-list">
        {libraryClips.length === 0 && (
          <div className="clip-empty">
            No clips found.<br />
            Add videos to your <code>media/clips</code> folder.
          </div>
        )}
        {libraryClips.map((clip) => (
          <div
            key={clip.id}
            className="clip-item"
            draggable
            onDragStart={(e) => handleDragStart(e, clip)}
            title={clip.filename}
          >
            <div className="clip-thumb">
              {clip.thumbnail && (
                <img
                  src={clip.thumbnail}
                  alt=""
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <div className="clip-thumb-overlay">
                <span className="clip-drag-icon">⠿</span>
              </div>
            </div>
            <div className="clip-meta">
              <div className="clip-name">{clip.filename}</div>
              <div className="clip-duration">{clip.duration?.toFixed(2)}s</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
