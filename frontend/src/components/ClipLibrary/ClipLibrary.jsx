import React, { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import './ClipLibrary.css'

export default function ClipLibrary() {
  const libraryClips = useStore((s) => s.libraryClips)
  const inUseClipFilenames = useStore((s) => s.inUseClipFilenames)
  const moveClipToInUse = useStore((s) => s.moveClipToInUse)
  const moveClipFromInUse = useStore((s) => s.moveClipFromInUse)

  const [inUseOpen, setInUseOpen] = useState(false)
  const [filter, setFilter] = useState('')
  // { x, y, clip, isInUse } while the right-click menu is showing
  const [menu, setMenu] = useState(null)

  const { activeClips, inUseClips, activeTotal } = useMemo(() => {
    const inUse = new Set(inUseClipFilenames)
    const query = filter.trim().toLowerCase()
    const matches = (c) => !query || c.filename.toLowerCase().includes(query)
    const active = libraryClips.filter((c) => !inUse.has(c.filename))
    return {
      activeClips: active.filter(matches),
      inUseClips: libraryClips.filter((c) => inUse.has(c.filename) && matches(c)),
      activeTotal: active.length,
    }
  }, [libraryClips, inUseClipFilenames, filter])

  const filtering = filter.trim() !== ''

  // Any click, scroll, resize, or Escape dismisses the menu
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const handleDragStart = (e, clip) => {
    e.dataTransfer.setData('clipId', clip.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleContextMenu = (e, clip, isInUse) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, clip, isInUse })
  }

  const handleMenuAction = () => {
    if (menu.isInUse) {
      moveClipFromInUse(menu.clip.filename)
    } else {
      moveClipToInUse(menu.clip.filename)
    }
    setMenu(null)
  }

  const renderClip = (clip, isInUse) => (
    <div
      key={clip.id}
      className={`clip-item${isInUse ? ' clip-item-in-use' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, clip)}
      onContextMenu={(e) => handleContextMenu(e, clip, isInUse)}
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
  )

  return (
    <div className="clip-library">
      <div className="panel-header">
        Clips ({filtering ? `${activeClips.length} of ${activeTotal}` : activeTotal})
      </div>
      <div className="clip-filter">
        <input
          type="text"
          className="clip-filter-input"
          placeholder="Filter clips…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); e.target.blur() } }}
          spellCheck={false}
        />
        {filtering && (
          <button className="clip-filter-clear" onClick={() => setFilter('')} title="Clear filter">×</button>
        )}
      </div>
      <div className="clip-list">
        {libraryClips.length === 0 && (
          <div className="clip-empty">
            No clips found.<br />
            Add videos to your <code>media/clips</code> folder.
          </div>
        )}
        {libraryClips.length > 0 && activeClips.length === 0 && (
          <div className="clip-empty">
            {filtering && activeTotal > 0 ? `No clips match “${filter.trim()}”.` : 'All clips are In Use.'}
          </div>
        )}
        {activeClips.map((clip) => renderClip(clip, false))}
      </div>

      <div className={`clip-in-use-folder${inUseOpen ? ' open' : ''}`}>
        <button
          className="clip-in-use-header"
          onClick={() => setInUseOpen((o) => !o)}
          title="Right-click a clip to move it into or out of In Use"
        >
          <span className="clip-in-use-caret">{inUseOpen ? '▾' : '▸'}</span>
          📁 In Use ({inUseClips.length})
        </button>
        {inUseOpen && (
          <div className="clip-list clip-in-use-list">
            {inUseClips.length === 0 && (
              <div className="clip-empty">
                {filtering && inUseClipFilenames.length > 0
                  ? `No In Use clips match “${filter.trim()}”.`
                  : 'Right-click a clip and choose “Move to In Use”.'}
              </div>
            )}
            {inUseClips.map((clip) => renderClip(clip, true))}
          </div>
        )}
      </div>

      {menu && (
        <div
          className="clip-context-menu"
          style={{ left: menu.x, top: menu.y }}
          // Keep the window mousedown listener from closing the menu before the click lands
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="clip-context-item" onClick={handleMenuAction}>
            {menu.isInUse ? '↩ Move back to Clips' : '📁 Move to In Use'}
          </button>
        </div>
      )}
    </div>
  )
}
