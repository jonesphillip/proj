import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Project,
  VideoSource,
  AudioSource,
  Timeline,
  Track,
  Segment,
  VideoSegment,
  CaptionSegment,
  ZoomEffectSegment,
  ZoomKeyframe,
  CaptionStyle,
  ExportSettings,
  ExportRecord,
  OverlaySource,
  OverlaySegment,
  OverlayPosition,
  AudioSegment,
} from '@proj/shared';
import { DEFAULT_CAPTION_STYLE, EXPORT_PRESETS } from '@proj/shared';

const STORAGE_KEY = 'proj-project';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface TimelineState {
  project: Project | null;
  selectedSegmentIds: string[];
  history: Project[];
  historyIndex: number;
  saveStatus: SaveStatus;
  saveError: string | null;

  // Zoom picking mode
  zoomPickingSegmentId: string | null;
  zoomPickingKeyframeIndex: number | null;

  // Actions
  initProject: (source: VideoSource) => void;
  setPlayheadPosition: (position: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setPixelsPerSecond: (pps: number) => void;
  setScrollOffset: (offset: number) => void;
  reorderTrack: (trackId: string, toIndex: number) => void;

  // Segment actions
  selectSegment: (segmentId: string | null, addToSelection?: boolean) => void;
  clearSelection: () => void;
  addVideoSegment: (startTime: number, sourceStart: number, sourceEnd: number) => void;
  addCaptionSegment: (startTime: number, duration: number, text: string) => void;
  addZoomEffectSegment: (startTime: number, duration: number) => void;
  updateZoomEffect: (segmentId: string, updates: Partial<{ zoom: number; centerX: number; centerY: number; zoomInDuration: number; zoomOutDuration: number }>) => void;
  updateSegment: (segmentId: string, updates: Partial<Segment>) => void;
  deleteSegment: (segmentId: string) => void;
  splitSegment: (segmentId: string, splitTime: number) => void;
  moveSegment: (segmentId: string, newStartTime: number) => void;
  trimSegment: (segmentId: string, newStart: number, newEnd: number) => void;
  trimVideoSource: (segmentId: string, newSourceStart: number, newSourceEnd: number) => void;
  mergeVideoSegments: () => void;

  // Effects
  setSpeedEffect: (segmentId: string, rate: number) => void;
  addZoomKeyframe: (segmentId: string, keyframe: ZoomKeyframe) => void;
  updateZoomKeyframe: (segmentId: string, index: number, keyframe: ZoomKeyframe) => void;
  removeZoomKeyframe: (segmentId: string, index: number) => void;

  // Captions
  updateCaptionStyle: (segmentId: string, style: Partial<CaptionStyle>) => void;
  updateCaptionText: (segmentId: string, text: string) => void;

  // Zoom picking
  startZoomPicking: (segmentId: string, keyframeIndex: number) => void;
  stopZoomPicking: () => void;
  setZoomCenter: (x: number, y: number) => void;

  // Overlay
  addOverlaySource: (source: OverlaySource) => void;
  addOverlaySegment: (overlaySourceId: string, startTime: number, sourceStart: number, sourceEnd: number, position?: OverlayPosition) => void;
  updateOverlaySegment: (segmentId: string, updates: Partial<OverlaySegment>) => void;
  combineOverlaySegments: (segmentIds: string[]) => void;

  // Audio
  addAudioSource: (source: AudioSource) => void;
  addAudioSegment: (audioSourceId: string, startTime: number, sourceStart: number, sourceEnd: number) => void;
  updateAudioSegment: (segmentId: string, updates: Partial<AudioSegment>) => void;
  setAudioEffect: (segmentId: string, muted: boolean, volume: number) => void;

  // Export
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  addExportRecord: (record: ExportRecord) => void;

  // History
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;

  // Persistence
  loadFromStorage: () => boolean;
  clearProject: () => void;

  // Source
  updateSource: (updates: Partial<VideoSource>) => void;

  // Server persistence
  saveProjectToServer: () => Promise<void>;
  loadProjectFromServer: (id: string) => Promise<boolean>;
  migrateAndSave: () => Promise<void>;
}

function createDefaultTimeline(source: VideoSource): Timeline {
  const videoTrack: Track = {
    id: 'video-track',
    type: 'video',
    name: 'Video',
    segments: [{
      id: nanoid(),
      trackId: 'video-track',
      type: 'video',
      startTime: 0,
      duration: source.duration,
      sourceStart: 0,
      sourceEnd: source.duration,
      effects: {},
    } as VideoSegment],
  };

  // Auto-fit: aim for ~600px total width initially (allows some scroll room)
  const defaultPps = Math.max(1, Math.min(100, 600 / source.duration));

  return {
    duration: source.duration,
    pixelsPerSecond: defaultPps,
    scrollOffset: 0,
    playheadPosition: 0,
    isPlaying: false,
    tracks: [videoTrack],
  };
}

// Track definitions for on-demand creation
const TRACK_DEFS: Record<string, { id: string; type: Track['type']; name: string }> = {
  caption: { id: 'caption-track', type: 'caption', name: 'Captions' },
  effect: { id: 'effects-track', type: 'effect', name: 'Effects' },
  overlay: { id: 'overlay-track', type: 'overlay', name: 'Overlay' },
  audio: { id: 'audio-track', type: 'audio', name: 'Audio' },
};

// Ensure a track of the given type exists, creating it if needed (appended at end)
function ensureTrack(tracks: Track[], type: string): Track[] {
  if (tracks.some(t => t.type === type)) return tracks;
  const def = TRACK_DEFS[type];
  if (!def) return tracks;
  return [...tracks, { ...def, segments: [] }];
}

// Helper: Recompute video segment positions to ensure they're continuous
function recomputeVideoPositions(tracks: Track[]): Track[] {
  return tracks.map(track => {
    if (track.type !== 'video') return track;

    // Sort segments by their source start time to maintain original order
    const sortedSegments = [...track.segments].sort((a, b) => {
      const aVideo = a as VideoSegment;
      const bVideo = b as VideoSegment;
      return aVideo.sourceStart - bVideo.sourceStart;
    });

    // Recompute start times so segments are continuous
    let currentTime = 0;
    const repositionedSegments = sortedSegments.map(seg => {
      const videoSeg = seg as VideoSegment;
      const speedRate = videoSeg.effects.speed?.rate || 1;
      const sourceDuration = videoSeg.sourceEnd - videoSeg.sourceStart;
      const playbackDuration = sourceDuration / speedRate;

      const newSeg = {
        ...videoSeg,
        startTime: currentTime,
        duration: playbackDuration,
      };
      currentTime += playbackDuration;
      return newSeg;
    });

    return { ...track, segments: repositionedSegments };
  });
}

function createDefaultProject(source: VideoSource): Project {
  return {
    id: nanoid(),
    name: source.filename.replace(/\.[^.]+$/, ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source,
    timeline: createDefaultTimeline(source),
    exportSettings: {
      preset: 'twitter-720p',
      ...EXPORT_PRESETS['twitter-720p'],
    },
    overlaySources: [],
  };
}

// Ensure project has all required fields (migration for older projects)
function migrateProject(project: Project): Project {
  let migrated = project;
  if (!migrated.overlaySources) {
    migrated = { ...migrated, overlaySources: [] };
  }
  if (!migrated.audioSources) {
    migrated = { ...migrated, audioSources: [] };
  }
  // Remove empty non-video tracks (tracks are now created on demand)
  const tracks = migrated.timeline.tracks;
  const filtered = tracks.filter(t => t.type === 'video' || t.segments.length > 0);
  if (filtered.length !== tracks.length) {
    migrated = {
      ...migrated,
      timeline: { ...migrated.timeline, tracks: filtered },
    };
  }
  return migrated;
}

// Helper: Apply a transform to tracks and update the project in one step
function updateTracks(
  get: () => TimelineState,
  set: (partial: Partial<TimelineState>) => void,
  transform: (tracks: Track[], project: Project) => Track[],
  extra?: Partial<TimelineState> & { duration?: number },
): void {
  const state = get();
  if (!state.project) return;
  const newTracks = transform(state.project.timeline.tracks, state.project);
  const { duration, ...extraState } = extra ?? {};
  set({
    project: {
      ...state.project,
      updatedAt: Date.now(),
      timeline: {
        ...state.project.timeline,
        tracks: newTracks,
        ...(duration !== undefined ? { duration } : {}),
      },
    },
    ...extraState,
  });
}

// Helper: Map over every segment in every track
function mapSegments(tracks: Track[], fn: (seg: Segment) => Segment): Track[] {
  return tracks.map(track => ({
    ...track,
    segments: track.segments.map(fn),
  }));
}

// Helper: Compute the max end time across all tracks
function computeMaxEndTime(tracks: Track[]): number {
  return Math.max(
    ...tracks.flatMap(t => t.segments.map(s => s.startTime + s.duration)),
    0.1,
  );
}

// Debounce timer for auto-save
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useTimelineStore = create<TimelineState>()(subscribeWithSelector((set, get) => ({
  project: null,
  selectedSegmentIds: [],
  history: [],
  historyIndex: -1,
  saveStatus: 'idle' as SaveStatus,
  saveError: null,
  zoomPickingSegmentId: null,
  zoomPickingKeyframeIndex: null,

  initProject: (source) => {
    const project = createDefaultProject(source);
    set({
      project,
      selectedSegmentIds: [],
      history: [project],
      historyIndex: 0,
    });
  },

  updateSource: (updates) => {
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          source: { ...state.project.source, ...updates },
        },
      };
    });
  },

  setPlayheadPosition: (position) => {
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            playheadPosition: Math.max(0, Math.min(position, state.project.timeline.duration)),
          },
        },
      };
    });
  },

  setIsPlaying: (isPlaying) => {
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, isPlaying },
        },
      };
    });
  },

  setPixelsPerSecond: (pps) => {
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, pixelsPerSecond: Math.max(1, Math.min(500, pps)) },
        },
      };
    });
  },

  setScrollOffset: (offset) => {
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, scrollOffset: Math.max(0, offset) },
        },
      };
    });
  },

  reorderTrack: (trackId, toIndex) => {
    set((state) => {
      if (!state.project) return state;
      const tracks = [...state.project.timeline.tracks];
      const fromIndex = tracks.findIndex(t => t.id === trackId);
      if (fromIndex < 0 || fromIndex === toIndex) return state;
      const [moved] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, moved);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, tracks },
        },
      };
    });
  },

  selectSegment: (segmentId, addToSelection = false) => {
    if (segmentId === null) {
      set({ selectedSegmentIds: [] });
      return;
    }

    set((state) => {
      if (addToSelection) {
        // Toggle selection if already selected, otherwise add
        if (state.selectedSegmentIds.includes(segmentId)) {
          return { selectedSegmentIds: state.selectedSegmentIds.filter(id => id !== segmentId) };
        }
        return { selectedSegmentIds: [...state.selectedSegmentIds, segmentId] };
      }
      // Single select
      return { selectedSegmentIds: [segmentId] };
    });
  },

  clearSelection: () => {
    set({ selectedSegmentIds: [] });
  },

  addVideoSegment: (startTime, sourceStart, sourceEnd) => {
    const segment: VideoSegment = {
      id: nanoid(),
      trackId: 'video-track',
      type: 'video',
      startTime,
      duration: sourceEnd - sourceStart,
      sourceStart,
      sourceEnd,
      effects: {},
    };

    updateTracks(get, set, (tracks) =>
      tracks.map(track =>
        track.id === 'video-track'
          ? { ...track, segments: [...track.segments, segment] }
          : track
      ),
    );
    get().saveHistory();
  },

  addCaptionSegment: (startTime, duration, text) => {
    const segment: CaptionSegment = {
      id: nanoid(),
      trackId: 'caption-track',
      type: 'caption',
      startTime,
      duration,
      text,
      style: { ...DEFAULT_CAPTION_STYLE },
      effects: {},
    };

    updateTracks(get, set, (tracks) => {
      const withTrack = ensureTrack(tracks, 'caption');
      return withTrack.map(track =>
        track.id === 'caption-track'
          ? { ...track, segments: [...track.segments, segment] }
          : track
      );
    });
    get().saveHistory();
  },

  addZoomEffectSegment: (startTime, duration) => {
    const segment: ZoomEffectSegment = {
      id: nanoid(),
      trackId: 'effects-track',
      type: 'zoom',
      startTime,
      duration,
      zoom: 1.5,
      centerX: 0.5,
      centerY: 0.5,
      zoomInDuration: 0.3,
      zoomOutDuration: 0.3,
      effects: {},
    };

    updateTracks(get, set, (tracks) => {
      const withTrack = ensureTrack(tracks, 'effect');
      return withTrack.map(track =>
        track.id === 'effects-track'
          ? { ...track, segments: [...track.segments, segment] }
          : track
      );
    }, { selectedSegmentIds: [segment.id] });
    get().saveHistory();
  },

  updateZoomEffect: (segmentId, updates) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg =>
        seg.id === segmentId && seg.type === 'zoom' ? { ...seg, ...updates } : seg
      ),
    );
  },

  updateSegment: (segmentId, updates) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg =>
        seg.id === segmentId ? { ...seg, ...updates } : seg
      ),
    );
  },

  deleteSegment: (segmentId) => {
    const state = get();
    if (!state.project) return;

    const filtered = state.project.timeline.tracks.map(track => ({
      ...track,
      segments: track.segments.filter(seg => seg.id !== segmentId),
    }));
    const newTracks = recomputeVideoPositions(filtered);
    const duration = computeMaxEndTime(newTracks);

    updateTracks(get, set, () => newTracks, {
      duration,
      selectedSegmentIds: state.selectedSegmentIds.filter(id => id !== segmentId),
    });
    get().saveHistory();
  },

  splitSegment: (segmentId, splitTime) => {
    updateTracks(get, set, (tracks) =>
      tracks.map(track => {
        const segmentIndex = track.segments.findIndex(s => s.id === segmentId);
        if (segmentIndex === -1) return track;

        const segment = track.segments[segmentIndex];
        const relativeTime = splitTime - segment.startTime;

        if (relativeTime <= 0 || relativeTime >= segment.duration) return track;

        if (segment.type === 'video' || segment.type === 'overlay' || segment.type === 'audio') {
          const sourceSeg = segment as VideoSegment | OverlaySegment | AudioSegment;
          const sourceRelative = relativeTime * (sourceSeg.sourceEnd - sourceSeg.sourceStart) / segment.duration;
          const first = { ...sourceSeg, duration: relativeTime, sourceEnd: sourceSeg.sourceStart + sourceRelative };
          const second = { ...sourceSeg, id: nanoid(), startTime: splitTime, duration: segment.duration - relativeTime, sourceStart: sourceSeg.sourceStart + sourceRelative };
          const newSegments = [...track.segments];
          newSegments.splice(segmentIndex, 1, first, second);
          return { ...track, segments: newSegments };
        }

        // Caption and zoom segments: split by time only (no source range)
        if (segment.type === 'caption' || segment.type === 'zoom') {
          const first = { ...segment, duration: relativeTime };
          const second = { ...segment, id: nanoid(), startTime: splitTime, duration: segment.duration - relativeTime };
          const newSegments = [...track.segments];
          newSegments.splice(segmentIndex, 1, first, second);
          return { ...track, segments: newSegments };
        }

        return track;
      }),
    );
    get().saveHistory();
  },

  moveSegment: (segmentId, newStartTime) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg =>
        seg.id === segmentId ? { ...seg, startTime: Math.max(0, newStartTime) } : seg
      ),
    );
  },

  trimSegment: (segmentId, newStart, newEnd) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== segmentId) return seg;

        if (seg.type === 'video') {
          const videoSeg = seg as VideoSegment;
          const sourceDuration = videoSeg.sourceEnd - videoSeg.sourceStart;
          const ratio = sourceDuration / seg.duration;

          return {
            ...videoSeg,
            startTime: newStart,
            duration: newEnd - newStart,
            sourceStart: videoSeg.sourceStart + (newStart - seg.startTime) * ratio,
            sourceEnd: videoSeg.sourceEnd + (newEnd - (seg.startTime + seg.duration)) * ratio,
          };
        }

        return {
          ...seg,
          startTime: newStart,
          duration: newEnd - newStart,
        };
      }),
    );
  },

  trimVideoSource: (segmentId, newSourceStart, newSourceEnd) => {
    const state = get();
    if (!state.project) return;

    const minSourceDuration = 0.1;
    const maxSourceEnd = state.project.source.duration;

    const clampedStart = Math.max(0, newSourceStart);
    const clampedEnd = Math.min(maxSourceEnd, newSourceEnd);

    if (clampedEnd - clampedStart < minSourceDuration) return;

    const mapped = mapSegments(state.project.timeline.tracks, seg => {
      if (seg.id !== segmentId || seg.type !== 'video') return seg;
      return { ...seg, sourceStart: clampedStart, sourceEnd: clampedEnd };
    });
    const newTracks = recomputeVideoPositions(mapped);
    const duration = computeMaxEndTime(newTracks);

    updateTracks(get, set, () => newTracks, { duration });
  },

  mergeVideoSegments: () => {
    const state = get();
    if (!state.project || state.selectedSegmentIds.length < 2) return;

    const videoTrack = state.project.timeline.tracks.find(t => t.type === 'video');
    if (!videoTrack) return;

    const selectedSegments = state.selectedSegmentIds
      .map(id => videoTrack.segments.find(s => s.id === id))
      .filter((s): s is VideoSegment => s !== undefined && s.type === 'video');

    if (selectedSegments.length < 2) return;

    const sortedBySource = [...selectedSegments].sort((a, b) => a.sourceStart - b.sourceStart);

    // Check if segments are consecutive in source video (allowing small gaps for floating point)
    for (let i = 0; i < sortedBySource.length - 1; i++) {
      const current = sortedBySource[i];
      const next = sortedBySource[i + 1];
      const gap = Math.abs(current.sourceEnd - next.sourceStart);
      if (gap > 0.05) {
        return;
      }
    }

    const mergedSegment: VideoSegment = {
      id: nanoid(),
      trackId: 'video-track',
      type: 'video',
      startTime: Math.min(...sortedBySource.map(s => s.startTime)),
      duration: sortedBySource.reduce((sum, s) => sum + s.duration, 0),
      sourceStart: sortedBySource[0].sourceStart,
      sourceEnd: sortedBySource[sortedBySource.length - 1].sourceEnd,
      effects: {},
    };

    const selectedIds = new Set(state.selectedSegmentIds);
    updateTracks(get, set, (tracks) =>
      tracks.map(track => {
        if (track.id !== 'video-track') return track;
        const filteredSegments = track.segments.filter(s => !selectedIds.has(s.id));
        return {
          ...track,
          segments: [...filteredSegments, mergedSegment].sort((a, b) => a.startTime - b.startTime),
        };
      }),
      { selectedSegmentIds: [mergedSegment.id] },
    );
    get().saveHistory();
  },

  setSpeedEffect: (segmentId, rate) => {
    const state = get();
    if (!state.project) return;

    const mapped = mapSegments(state.project.timeline.tracks, seg => {
      if (seg.id !== segmentId || seg.type !== 'video') return seg;
      return {
        ...seg,
        effects: {
          ...seg.effects,
          speed: rate === 1 ? undefined : { rate },
        },
      };
    });
    const newTracks = recomputeVideoPositions(mapped);
    const duration = computeMaxEndTime(newTracks);

    updateTracks(get, set, () => newTracks, { duration });
    get().saveHistory();
  },

  addZoomKeyframe: (segmentId, keyframe) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== segmentId || seg.type !== 'video') return seg;
        const zoom = seg.effects.zoom || { keyframes: [] };
        return {
          ...seg,
          effects: {
            ...seg.effects,
            zoom: {
              keyframes: [...zoom.keyframes, keyframe].sort((a, b) => a.time - b.time),
            },
          },
        };
      }),
    );
    get().saveHistory();
  },

  updateZoomKeyframe: (segmentId, index, keyframe) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== segmentId || seg.type !== 'video' || !seg.effects.zoom) return seg;
        const keyframes = [...seg.effects.zoom.keyframes];
        keyframes[index] = keyframe;
        return {
          ...seg,
          effects: {
            ...seg.effects,
            zoom: { keyframes: keyframes.sort((a, b) => a.time - b.time) },
          },
        };
      }),
    );
  },

  removeZoomKeyframe: (segmentId, index) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== segmentId || seg.type !== 'video' || !seg.effects.zoom) return seg;
        const keyframes = seg.effects.zoom.keyframes.filter((_, i) => i !== index);
        return {
          ...seg,
          effects: {
            ...seg.effects,
            zoom: keyframes.length > 0 ? { keyframes } : undefined,
          },
        };
      }),
    );
    get().saveHistory();
  },

  updateCaptionStyle: (segmentId, style) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== segmentId || seg.type !== 'caption') return seg;
        const captionSeg = seg as CaptionSegment;
        return { ...captionSeg, style: { ...captionSeg.style, ...style } };
      }),
    );
  },

  updateCaptionText: (segmentId, text) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg =>
        seg.id === segmentId && seg.type === 'caption' ? { ...seg, text } : seg
      ),
    );
  },

  startZoomPicking: (segmentId, keyframeIndex) => {
    set({
      zoomPickingSegmentId: segmentId,
      zoomPickingKeyframeIndex: keyframeIndex,
    });
  },

  stopZoomPicking: () => {
    set({
      zoomPickingSegmentId: null,
      zoomPickingKeyframeIndex: null,
    });
  },

  setZoomCenter: (x, y) => {
    const state = get();
    if (!state.zoomPickingSegmentId || state.zoomPickingKeyframeIndex === null) return;

    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== state.zoomPickingSegmentId) return seg;

        // Handle zoom effect segments (keyframeIndex === -1)
        if (seg.type === 'zoom' && state.zoomPickingKeyframeIndex === -1) {
          return { ...seg, centerX: x, centerY: y };
        }

        // Handle video segment keyframes
        if (seg.type === 'video' && seg.effects.zoom) {
          const keyframes = [...seg.effects.zoom.keyframes];
          if (state.zoomPickingKeyframeIndex !== null && state.zoomPickingKeyframeIndex >= 0 && keyframes[state.zoomPickingKeyframeIndex]) {
            keyframes[state.zoomPickingKeyframeIndex] = {
              ...keyframes[state.zoomPickingKeyframeIndex],
              x,
              y,
            };
          }
          return {
            ...seg,
            effects: { ...seg.effects, zoom: { keyframes } },
          };
        }

        return seg;
      }),
      { zoomPickingSegmentId: null, zoomPickingKeyframeIndex: null },
    );
    get().saveHistory();
  },

  addOverlaySource: (source) => {
    const state = get();
    if (!state.project) return;

    set({
      project: {
        ...state.project,
        updatedAt: Date.now(),
        overlaySources: [...state.project.overlaySources, source],
      },
    });
    get().saveHistory();
  },

  addOverlaySegment: (overlaySourceId, startTime, sourceStart, sourceEnd, position?) => {
    const segment: OverlaySegment = {
      id: nanoid(),
      trackId: 'overlay-track',
      type: 'overlay',
      startTime,
      duration: sourceEnd - sourceStart,
      sourceStart,
      sourceEnd,
      overlaySourceId,
      position: position || { x: 0.6, y: 0.5, width: 0.35, height: 0.4 },
      opacity: 1,
      borderRadius: 0,
      effects: {},
    };

    updateTracks(get, set, (tracks) => {
      const withTrack = ensureTrack(tracks, 'overlay');
      return withTrack.map(track =>
        track.id === 'overlay-track'
          ? { ...track, segments: [...track.segments, segment] }
          : track
      );
    }, { selectedSegmentIds: [segment.id] });
    get().saveHistory();
  },

  updateOverlaySegment: (segmentId, updates) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg =>
        seg.id === segmentId && seg.type === 'overlay' ? { ...seg, ...updates } : seg
      ),
    );
  },

  combineOverlaySegments: (segmentIds) => {
    const state = get();
    if (!state.project || segmentIds.length < 2) return;

    const allSegments = state.project.timeline.tracks.flatMap(t => t.segments);
    const overlaySegs = segmentIds
      .map(id => allSegments.find(s => s.id === id && s.type === 'overlay') as OverlaySegment | undefined)
      .filter((s): s is OverlaySegment => !!s);

    if (overlaySegs.length < 2) return;

    overlaySegs.sort((a, b) => a.startTime - b.startTime);

    const leftmost = overlaySegs[0];
    const lastSeg = overlaySegs[overlaySegs.length - 1];
    const combined: OverlaySegment = {
      ...leftmost,
      duration: overlaySegs.reduce((sum, s) => sum + s.duration, 0),
      sourceStart: leftmost.sourceStart,
      sourceEnd: lastSeg.sourceEnd,
    };

    const removeIds = new Set(segmentIds);
    updateTracks(get, set, (tracks) =>
      tracks.map(track => ({
        ...track,
        segments: track.segments
          .filter(seg => !removeIds.has(seg.id) || seg.id === leftmost.id)
          .map(seg => seg.id === leftmost.id ? combined : seg),
      })),
      { selectedSegmentIds: [leftmost.id] },
    );
    get().saveHistory();
  },

  addAudioSource: (source) => {
    const state = get();
    if (!state.project) return;

    set({
      project: {
        ...state.project,
        updatedAt: Date.now(),
        audioSources: [...(state.project.audioSources || []), source],
      },
    });
    get().saveHistory();
  },

  addAudioSegment: (audioSourceId, startTime, sourceStart, sourceEnd) => {
    const segment: AudioSegment = {
      id: nanoid(),
      trackId: 'audio-track',
      type: 'audio',
      startTime,
      duration: sourceEnd - sourceStart,
      sourceStart,
      sourceEnd,
      audioSourceId,
      volume: 1.0,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      muted: false,
      effects: {},
    };

    updateTracks(get, set, (tracks) => {
      const withTrack = ensureTrack(tracks, 'audio');
      return withTrack.map(track =>
        track.id === 'audio-track'
          ? { ...track, segments: [...track.segments, segment] }
          : track
      );
    }, { selectedSegmentIds: [segment.id] });
    get().saveHistory();
  },

  updateAudioSegment: (segmentId, updates) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg =>
        seg.id === segmentId && seg.type === 'audio' ? { ...seg, ...updates } : seg
      ),
    );
  },

  setAudioEffect: (segmentId, muted, volume) => {
    updateTracks(get, set, (tracks) =>
      mapSegments(tracks, seg => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          effects: {
            ...seg.effects,
            audioMuted: muted,
            audioVolume: volume,
          },
        };
      }),
    );
  },

  setExportSettings: (settings) => {
    const state = get();
    if (!state.project) return;

    set({
      project: {
        ...state.project,
        exportSettings: { ...state.project.exportSettings, ...settings },
      },
    });
  },

  addExportRecord: (record) => {
    const state = get();
    if (!state.project) return;

    set({
      project: {
        ...state.project,
        updatedAt: Date.now(),
        exports: [...(state.project.exports || []), record],
      },
    });
  },

  saveHistory: () => {
    const state = get();
    if (!state.project) return;

    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(state.project)));

    // Keep max 50 history entries
    if (newHistory.length > 50) {
      newHistory.shift();
    }

    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;

    const newIndex = state.historyIndex - 1;
    set({
      project: JSON.parse(JSON.stringify(state.history[newIndex])),
      historyIndex: newIndex,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;

    const newIndex = state.historyIndex + 1;
    set({
      project: JSON.parse(JSON.stringify(state.history[newIndex])),
      historyIndex: newIndex,
    });
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const project = migrateProject(JSON.parse(stored) as Project);
        set({
          project,
          selectedSegmentIds: [],
          history: [project],
          historyIndex: 0,
        });
        // Update URL with video ID
        const url = new URL(window.location.href);
        url.searchParams.set('video', project.source.id);
        window.history.replaceState({}, '', url.toString());
        return true;
      }
    } catch (e) {
      console.error('Failed to load project from storage:', e);
    }
    return false;
  },

  clearProject: () => {
    localStorage.removeItem(STORAGE_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('video');
    window.history.replaceState({}, '', url.toString());
    set({
      project: null,
      selectedSegmentIds: [],
      history: [],
      historyIndex: -1,
      saveStatus: 'idle',
      saveError: null,
    });
  },

  saveProjectToServer: async () => {
    const state = get();
    if (!state.project) return;

    set({ saveStatus: 'saving', saveError: null });

    try {
      const response = await fetch(`/api/projects/${state.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: state.project }),
      });

      const result = await response.json();

      if (result.success) {
        set({ saveStatus: 'saved' });
        // Reset to idle after 2s
        setTimeout(() => {
          if (get().saveStatus === 'saved') {
            set({ saveStatus: 'idle' });
          }
        }, 2000);
      } else {
        set({ saveStatus: 'error', saveError: result.error || 'Failed to save' });
      }
    } catch (error) {
      set({
        saveStatus: 'error',
        saveError: error instanceof Error ? error.message : 'Failed to save',
      });
    }
  },

  loadProjectFromServer: async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      const result = await response.json();

      if (result.success && result.project) {
        const project = migrateProject(result.project as Project);
        set({
          project,
          selectedSegmentIds: [],
          history: [project],
          historyIndex: 0,
          saveStatus: 'saved',
        });
        // Update localStorage as backup
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        // Update URL
        const url = new URL(window.location.href);
        url.searchParams.set('video', project.source.id);
        window.history.replaceState({}, '', url.toString());
        return true;
      }
    } catch (error) {
      console.error('Failed to load project from server:', error);
    }
    return false;
  },

  migrateAndSave: async () => {
    const state = get();
    if (!state.project) return;

    // Convert any absolute paths to relative URLs
    const migratedProject = {
      ...state.project,
      source: {
        ...state.project.source,
        // Convert absolute path to relative URL if needed
        path: state.project.source.path.startsWith('/uploads/')
          ? state.project.source.path
          : `/uploads/${state.project.source.path.split('/').pop()}`,
      },
    };

    set({ project: migratedProject });

    // Save to server
    await get().saveProjectToServer();
  },
})));

// Auto-save to localStorage and server when project changes
useTimelineStore.subscribe(
  (state) => state.project,
  (project) => {
    if (project) {
      try {
        // Immediate localStorage save (backup)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        // Update URL with video ID
        const url = new URL(window.location.href);
        if (url.searchParams.get('video') !== project.source.id) {
          url.searchParams.set('video', project.source.id);
          window.history.replaceState({}, '', url.toString());
        }

        // Debounced server save (2s after last change)
        if (saveDebounceTimer) {
          clearTimeout(saveDebounceTimer);
        }
        saveDebounceTimer = setTimeout(() => {
          useTimelineStore.getState().saveProjectToServer();
        }, 2000);
      } catch (e) {
        console.error('Failed to save project to storage:', e);
      }
    }
  }
);
