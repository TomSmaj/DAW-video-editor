import React, { useEffect, useRef, useState } from 'react'
import ClipLibrary from './components/ClipLibrary/ClipLibrary'
import ClipPreview from './components/ClipPreview/ClipPreview'
import VideoPreview from './components/VideoPreview/VideoPreview'
import Timeline from './components/Timeline/Timeline'
import Toolbar from './components/Toolbar/Toolbar'
import LogsView from './components/LogsView/LogsView'
import useStore from './store/useStore'
import './App.css'
import reportError from './utils/reportError'

const MIN_TOP = 160
const MIN_BOTTOM = 120

export default function App() {
  const { setLibraryClips, setMusicFiles, view, setView } = useStore()
  const [topHeight, setTopHeight] = useState(null)
  const containerRef = useRef(null)
  const dragging = useRef(false)
  const dragStart = useRef(0)
  const dragStartHeight = useRef(0)

  useEffect(() => {
    fetch('/api/clips').then((r) => r.json()).then(setLibraryClips).catch((err) => {
      console.error(err)
      reportError('failed to load clip library', { error: err.message })
    })
    fetch('/api/music').then((r) => r.json()).then(setMusicFiles).catch((err) => {
      console.error(err)
      reportError('failed to load music list', { error: err.message })
    })
  }, [])

  // The Logs page lives at #/logs so it can be linked to and browser back works
  useEffect(() => {
    const sync = () => setView(window.location.hash === '#/logs' ? 'logs' : 'app')
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [setView])

  const onDividerMouseDown = (e) => {
    e.preventDefault()
    dragging.current = true
    dragStart.current = e.clientY
    dragStartHeight.current = containerRef.current?.querySelector('.main-panel')?.offsetHeight ?? 0
  }

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const dy = e.clientY - dragStart.current
      const totalH = containerRef.current?.clientHeight ?? 600
      const toolbarH = containerRef.current?.querySelector('.toolbar')?.offsetHeight ?? 0
      const newTop = Math.max(MIN_TOP, Math.min(totalH - toolbarH - MIN_BOTTOM - 6, dragStartHeight.current + dy))
      setTopHeight(newTop)
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // The editor stays mounted while hidden so a running render, playback
  // position, and scroll state survive a visit to the Logs page
  return (
    <>
    {view === 'logs' && <LogsView onBack={() => { window.location.hash = '' }} />}
    <div className="app" ref={containerRef} style={view === 'logs' ? { display: 'none' } : undefined}>
      <Toolbar />
      {/* flex-basis, not height: the panel's `flex: 1` sets flex-basis to 0%,
          which wins over height on the main axis and would ignore the drag */}
      <div
        className="main-panel"
        style={topHeight != null ? { flex: `0 1 ${topHeight}px` } : {}}
      >
        <ClipLibrary />
        <ClipPreview />
        <VideoPreview />
      </div>
      <div className="resize-divider" onMouseDown={onDividerMouseDown} />
      <Timeline />
    </div>
    </>
  )
}
