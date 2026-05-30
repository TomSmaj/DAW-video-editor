import React, { useEffect, useRef, useState } from 'react'
import ClipLibrary from './components/ClipLibrary/ClipLibrary'
import ClipPreview from './components/ClipPreview/ClipPreview'
import VideoPreview from './components/VideoPreview/VideoPreview'
import Timeline from './components/Timeline/Timeline'
import Toolbar from './components/Toolbar/Toolbar'
import useStore from './store/useStore'
import './App.css'

const MIN_TOP = 160
const MIN_BOTTOM = 120

export default function App() {
  const { setLibraryClips, setMusicFiles } = useStore()
  const [topHeight, setTopHeight] = useState(null)
  const containerRef = useRef(null)
  const dragging = useRef(false)
  const dragStart = useRef(0)
  const dragStartHeight = useRef(0)

  useEffect(() => {
    fetch('/api/clips').then((r) => r.json()).then(setLibraryClips).catch(console.error)
    fetch('/api/music').then((r) => r.json()).then(setMusicFiles).catch(console.error)
  }, [])

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

  return (
    <div className="app" ref={containerRef}>
      <Toolbar />
      <div className="main-panel" style={topHeight != null ? { height: topHeight } : {}}>
        <ClipLibrary />
        <ClipPreview />
        <VideoPreview />
      </div>
      <div className="resize-divider" onMouseDown={onDividerMouseDown} />
      <Timeline />
    </div>
  )
}
