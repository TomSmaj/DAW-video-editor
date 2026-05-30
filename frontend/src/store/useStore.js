import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export const BEAT_DIVISIONS = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
}

const BASE_PIXELS_PER_BEAT = 80

const useStore = create((set, get) => ({
  // Library
  libraryClips: [],
  musicFiles: [],

  // Project settings
  bpm: 120,
  beatDivision: 'quarter',
  snapToGrid: true,
  zoom: 1,

  // Derived
  pixelsPerBeat: BASE_PIXELS_PER_BEAT,

  // Timeline clips
  timelineClips: [],
  selectedClipId: null,

  // Music
  selectedMusicFile: null,

  // Playback
  isPlaying: false,
  currentTime: 0,

  // Actions — library
  setLibraryClips: (clips) => set({ libraryClips: clips }),
  setMusicFiles: (files) => set({ musicFiles: files }),

  // Actions — project settings
  setBpm: (bpm) => set({ bpm: Math.max(20, Math.min(300, bpm)) }),
  setBeatDivision: (div) => set({ beatDivision: div }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setZoom: (zoom) => set({ zoom, pixelsPerBeat: BASE_PIXELS_PER_BEAT * zoom }),
  setSelectedMusicFile: (file) => set({ selectedMusicFile: file }),

  // Helpers
  beatsToSeconds: (beats) => beats * (60 / get().bpm),
  secondsToBeats: (seconds) => seconds * (get().bpm / 60),

  getGridUnitBeats: () => BEAT_DIVISIONS[get().beatDivision] ?? 1,

  snapBeat: (beat) => {
    const { snapToGrid, getGridUnitBeats } = get()
    if (!snapToGrid) return beat
    const unit = getGridUnitBeats()
    return Math.round(beat / unit) * unit
  },

  // Timeline clip actions
  addTimelineClip: (libraryClip, startBeat, track = 0) => {
    const { bpm, getGridUnitBeats } = get()
    const gridUnit = getGridUnitBeats()
    const durationBeats = libraryClip.duration * (bpm / 60)
    const snappedDuration = Math.max(gridUnit, Math.round(durationBeats / gridUnit) * gridUnit)

    const clip = {
      id: uuidv4(),
      clipId: libraryClip.id,
      filename: libraryClip.filename,
      url: libraryClip.url,
      thumbnail: libraryClip.thumbnail,
      name: libraryClip.filename,
      clipDuration: libraryClip.duration,
      startBeat,
      durationBeats: snappedDuration,
      trimStart: 0,
      track,
    }
    set((state) => ({ timelineClips: [...state.timelineClips, clip], selectedClipId: clip.id }))
    return clip
  },

  updateTimelineClip: (id, updates) => {
    set((state) => ({
      timelineClips: state.timelineClips.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  },

  removeTimelineClip: (id) => {
    set((state) => ({
      timelineClips: state.timelineClips.filter((c) => c.id !== id),
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
    }))
  },

  selectClip: (id) => set({ selectedClipId: id }),

  // Playback
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),

  // Current project identity (null = unsaved)
  currentProjectId: null,
  currentProjectName: null,

  setCurrentProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),

  // Snapshot of saveable project state
  getProjectState: () => {
    const s = get()
    return {
      bpm: s.bpm,
      beatDivision: s.beatDivision,
      snapToGrid: s.snapToGrid,
      zoom: s.zoom,
      selectedMusicFile: s.selectedMusicFile,
      timelineClips: s.timelineClips,
    }
  },

  // Restore project state from a saved snapshot
  applyProjectState: (state) => {
    set({
      bpm: state.bpm ?? 120,
      beatDivision: state.beatDivision ?? 'quarter',
      snapToGrid: state.snapToGrid ?? true,
      zoom: state.zoom ?? 1,
      pixelsPerBeat: BASE_PIXELS_PER_BEAT * (state.zoom ?? 1),
      selectedMusicFile: state.selectedMusicFile ?? null,
      timelineClips: state.timelineClips ?? [],
      selectedClipId: null,
      currentTime: 0,
      isPlaying: false,
    })
  },
}))

export default useStore
