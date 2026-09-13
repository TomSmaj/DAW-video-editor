import { useRef, useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import './VideoPreview.css'

export default function VideoPreview() {
  const { timelineClips, bpm, isPlaying } = useStore()
  const videoRef = useRef(null)
  const prevClipIdRef = useRef(null)
  const [showVideo, setShowVideo] = useState(false)

  // Refs so the subscribe callback always sees fresh values without re-subscribing
  const isPlayingRef = useRef(isPlaying)
  const timelineClipsRef = useRef(timelineClips)
  const bpmRef = useRef(bpm)
  isPlayingRef.current = isPlaying
  timelineClipsRef.current = timelineClips
  bpmRef.current = bpm

  const getActiveClipAt = (t) => {
    const beat = t * (bpmRef.current / 60)
    return timelineClipsRef.current.find(
      (c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats
    ) ?? null
  }

  const getSrcTime = (clip, t) =>
    clip.trimStart + (t * (bpmRef.current / 60) - clip.startBeat) / (bpmRef.current / 60)

  // Subscribe to currentTime imperatively — no re-renders on every frame
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      if (state.currentTime === prev.currentTime) return
      const video = videoRef.current
      if (!video) return

      const activeClip = getActiveClipAt(state.currentTime)

      if (!activeClip) {
        if (prevClipIdRef.current !== null) {
          video.pause()
          prevClipIdRef.current = null
          setShowVideo(false)
        }
        return
      }

      const srcTime = Math.max(0, getSrcTime(activeClip, state.currentTime))
      const clipChanged = activeClip.id !== prevClipIdRef.current
      prevClipIdRef.current = activeClip.id

      if (clipChanged) {
        setShowVideo(true)
        video.src = activeClip.url
        video.currentTime = srcTime
        if (isPlayingRef.current) video.play().catch(() => {})
      } else if (!isPlayingRef.current) {
        // Paused — keep in sync with scrubbing
        video.currentTime = srcTime
      }
      // Playing same clip — let it run natively, no per-frame seeking
    })
  }, []) // Set up once; refs provide fresh values

  // Handle play/pause transitions
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      if (prevClipIdRef.current) video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [isPlaying])

  return (
    <div className="video-preview">
      <div className="panel-header">Timeline Preview</div>
      <div className="video-preview-body">
        <video
          ref={videoRef}
          className="preview-video"
          muted
          playsInline
          style={{ display: showVideo ? 'block' : 'none' }}
        />
        {!showVideo && (
          <div className="preview-placeholder">
            <div className="preview-icon">▶</div>
            <div>Use playback controls<br />to preview the timeline</div>
          </div>
        )}
      </div>
    </div>
  )
}
