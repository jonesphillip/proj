import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useVideoPlayback } from '../../hooks/useVideoPlayback';
import type { Segment, CaptionSegment, VideoSegment, ZoomEffectSegment, OverlaySegment, AudioSegment, DeviceFrame, Timeline } from '@proj/shared';
import { DEVICE_FRAME_PRESETS } from '@proj/shared';

function isActiveAtTime(seg: Segment, time: number): boolean {
  return time >= seg.startTime && time < seg.startTime + seg.duration;
}

function getTrackSegments(timeline: Timeline, trackType: string): Segment[] {
  return timeline.tracks.find(t => t.type === trackType)?.segments ?? [];
}

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);

  // Track actual video display dimensions for caption positioning
  const [videoBounds, setVideoBounds] = useState<{ width: number; height: number } | null>(null);

  // Subscribe to specific values to ensure re-renders
  const project = useTimelineStore((state) => state.project);
  const setPlayheadPosition = useTimelineStore((state) => state.setPlayheadPosition);
  const setIsPlaying = useTimelineStore((state) => state.setIsPlaying);
  const zoomPickingSegmentId = useTimelineStore((state) => state.zoomPickingSegmentId);
  const setZoomCenter = useTimelineStore((state) => state.setZoomCenter);
  const stopZoomPicking = useTimelineStore((state) => state.stopZoomPicking);
  const selectedSegmentIds = useTimelineStore((state) => state.selectedSegmentIds);
  const updateZoomEffect = useTimelineStore((state) => state.updateZoomEffect);
  const updateOverlaySegment = useTimelineStore((state) => state.updateOverlaySegment);
  const undo = useTimelineStore((state) => state.undo);
  const redo = useTimelineStore((state) => state.redo);

  const overlayVideoRefs = useRef(new Map<string, HTMLVideoElement>());
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());

  // State for overlay drag/resize
  const [overlayDragState, setOverlayDragState] = useState<{
    overlayId: string;
    type: 'move' | 'resize';
    startX: number;
    startY: number;
    startPosition: { x: number; y: number; width: number; height: number };
    corner?: 'tl' | 'tr' | 'bl' | 'br';
  } | null>(null);

  // State for zoom box dragging/resizing
  const [zoomDragState, setZoomDragState] = useState<{
    type: 'move' | 'resize';
    startX: number;
    startY: number;
    startCenterX: number;
    startCenterY: number;
    startZoom: number;
    corner?: 'tl' | 'tr' | 'bl' | 'br';
  } | null>(null);

  const timeline = project?.timeline;
  const source = project?.source;
  const playheadPosition = timeline?.playheadPosition ?? 0;
  const isPlaying = timeline?.isPlaying ?? false;
  const isZoomPicking = zoomPickingSegmentId !== null;

  // Get all video segments for time mapping
  const videoSegments = useMemo(() => {
    if (!timeline) return [];
    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    if (!videoTrack) return [];
    return videoTrack.segments as VideoSegment[];
  }, [timeline]);

  // Video playback synchronization (timeupdate, seeking, speed)
  useVideoPlayback({
    videoRef,
    videoSegments,
    timeline,
    playheadPosition,
    isPlaying,
    setPlayheadPosition,
    setIsPlaying,
  });

  const sourceWidth = source?.width;
  const sourceHeight = source?.height;

  // Compute video display bounds from CONTAINER dimensions + source aspect ratio.
  // This avoids reading the video element (whose getBoundingClientRect is affected by CSS transforms).
  const getVideoBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container || !sourceWidth || !sourceHeight) return null;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    if (containerW === 0 || containerH === 0) return null;
    const sourceAspect = sourceWidth / sourceHeight;
    const containerAspect = containerW / containerH;
    if (containerAspect > sourceAspect) {
      const h = containerH;
      return { width: Math.round(h * sourceAspect), height: h };
    } else {
      const w = containerW;
      return { width: w, height: Math.round(w / sourceAspect) };
    }
  }, [sourceWidth, sourceHeight]);

  // Update video bounds state (triggers re-render for dependent UI)
  const updateVideoBounds = useCallback(() => {
    const bounds = getVideoBounds();
    if (bounds) setVideoBounds(bounds);
  }, [getVideoBounds]);

  // Handle video loaded
  const handleLoadedMetadata = useCallback(() => {
    updateVideoBounds();
  }, [updateVideoBounds]);

  // Track container resize to recompute video bounds
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sourceWidth || !sourceHeight) return;

    const resizeObserver = new ResizeObserver(() => {
      updateVideoBounds();
    });

    resizeObserver.observe(container);
    updateVideoBounds();
    return () => resizeObserver.disconnect();
  }, [sourceWidth, sourceHeight, updateVideoBounds]);


  // Handle video error
  const handleError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    console.error('Video error:', e.currentTarget.error);
  }, []);

  // Playback controls
  const handlePlayPause = useCallback(() => {
    setIsPlaying(!timeline?.isPlaying);
  }, [timeline?.isPlaying, setIsPlaying]);

  const handleFrameStep = useCallback((direction: number) => {
    if (!timeline || !source) return;
    const frameTime = 1 / source.fps;
    setPlayheadPosition(timeline.playheadPosition + direction * frameTime);
    setIsPlaying(false);
  }, [timeline, source, setPlayheadPosition, setIsPlaying]);

  const handleJumpToStart = useCallback(() => {
    setPlayheadPosition(0);
    setIsPlaying(false);
  }, [setPlayheadPosition, setIsPlaying]);

  const handleJumpToEnd = useCallback(() => {
    if (!timeline) return;
    setPlayheadPosition(timeline.duration);
    setIsPlaying(false);
  }, [timeline, setPlayheadPosition, setIsPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Undo: Cmd/Ctrl+Z
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y
      if ((isMod && e.key === 'z' && e.shiftKey) || (isMod && e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Skip other shortcuts if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleFrameStep(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleFrameStep(1);
          break;
        case 'Home':
          e.preventDefault();
          handleJumpToStart();
          break;
        case 'End':
          e.preventDefault();
          handleJumpToEnd();
          break;
        case 'j':
          handleFrameStep(-10);
          break;
        case 'k':
          handlePlayPause();
          break;
        case 'l':
          handleFrameStep(10);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, handleFrameStep, handleJumpToStart, handleJumpToEnd, undo, redo]);

  // Find active video segment at current playhead position (for audio controls)
  const activeVideoSegment = useMemo(() => {
    if (!videoSegments.length) return null;
    return videoSegments.find(seg => isActiveAtTime(seg, playheadPosition)) ?? null;
  }, [videoSegments, playheadPosition]);

  // All audio segments (stable reference -- not dependent on playhead)
  const allAudioSegments = useMemo(() => {
    if (!timeline) return [];
    return getTrackSegments(timeline, 'audio') as AudioSegment[];
  }, [timeline]);

  // All audio sync: video element mute/volume + audio track play/seek/fade
  // Uses a single RAF loop to avoid React re-render overhead during playback.
  // Derives timeline position from the video element's currentTime (continuous)
  // rather than the store's playheadPosition (updated only ~4/sec via timeupdate).
  const audioSegmentsRef = useRef(allAudioSegments);
  audioSegmentsRef.current = allAudioSegments;
  const videoSegmentsRef = useRef(videoSegments);
  videoSegmentsRef.current = videoSegments;

  // Convert video element's currentTime to timeline position
  const videoTimeToTimeline = useCallback((sourceTime: number): number => {
    for (const seg of videoSegmentsRef.current) {
      if (sourceTime >= seg.sourceStart && sourceTime < seg.sourceEnd) {
        const relSource = sourceTime - seg.sourceStart;
        const speedRate = seg.effects.speed?.rate || 1;
        return seg.startTime + (relSource / speedRate);
      }
    }
    return 0;
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      // Paused: set video audio from current segment, pause all audio track elements
      const video = videoRef.current;
      if (video && activeVideoSegment) {
        video.muted = activeVideoSegment.effects.audioMuted ?? false;
        video.volume = activeVideoSegment.effects.audioVolume ?? 1.0;
      } else if (video) {
        video.muted = true;
      }

      const refs = audioRefs.current;
      for (const [, el] of refs) {
        if (!el.paused) el.pause();
      }
      // Seek audio elements to current position
      for (const seg of audioSegmentsRef.current) {
        const el = refs.get(seg.id);
        if (!el) continue;
        const isActive = playheadPosition >= seg.startTime && playheadPosition < seg.startTime + seg.duration;
        if (isActive) {
          el.currentTime = seg.sourceStart + (playheadPosition - seg.startTime);
        }
      }
      return;
    }

    // Playing: RAF loop for all audio sync
    let rafId: number;
    let lastVideoMuted: boolean | null = null;
    let lastVideoVolume: number | null = null;

    const sync = () => {
      const video = videoRef.current;
      if (!video) { rafId = requestAnimationFrame(sync); return; }

      // Derive timeline position from video element (continuous, not store)
      const pos = videoTimeToTimeline(video.currentTime);

      // --- Video element audio ---
      // Find which video segment we're in
      let currentVideoSeg: VideoSegment | null = null;
      for (const seg of videoSegmentsRef.current) {
        if (pos >= seg.startTime && pos < seg.startTime + seg.duration) {
          currentVideoSeg = seg;
          break;
        }
      }

      if (currentVideoSeg) {
        const muted = currentVideoSeg.effects.audioMuted ?? false;
        const vol = currentVideoSeg.effects.audioVolume ?? 1.0;
        // Only touch the element when values actually change
        if (lastVideoMuted !== muted) { video.muted = muted; lastVideoMuted = muted; }
        if (lastVideoVolume !== vol) { video.volume = vol; lastVideoVolume = vol; }
      } else {
        if (lastVideoMuted !== true) { video.muted = true; lastVideoMuted = true; }
      }

      // --- Audio track elements ---
      const refs = audioRefs.current;
      for (const seg of audioSegmentsRef.current) {
        const el = refs.get(seg.id);
        if (!el) continue;

        const isActive = pos >= seg.startTime && pos < seg.startTime + seg.duration;

        if (!isActive || seg.muted) {
          if (!el.paused) el.pause();
          continue;
        }

        // Only seek if drifted significantly
        const targetTime = seg.sourceStart + (pos - seg.startTime);
        if (Math.abs(el.currentTime - targetTime) > 0.3) {
          el.currentTime = targetTime;
        }

        if (el.paused) {
          el.play().catch(() => {});
        }

        // Volume with fade
        let vol = seg.volume;
        const elapsed = pos - seg.startTime;
        const remaining = (seg.startTime + seg.duration) - pos;
        if (seg.fadeInDuration > 0 && elapsed < seg.fadeInDuration) {
          vol *= elapsed / seg.fadeInDuration;
        }
        if (seg.fadeOutDuration > 0 && remaining < seg.fadeOutDuration) {
          vol *= remaining / seg.fadeOutDuration;
        }
        el.volume = Math.max(0, Math.min(1, vol));
        el.muted = false;
      }

      rafId = requestAnimationFrame(sync);
    };

    // Initial sync: set video audio immediately
    const video = videoRef.current;
    if (video && activeVideoSegment) {
      video.muted = activeVideoSegment.effects.audioMuted ?? false;
      video.volume = activeVideoSegment.effects.audioVolume ?? 1.0;
    }
    // Start audio track elements at the right position
    const refs = audioRefs.current;
    for (const seg of audioSegmentsRef.current) {
      const el = refs.get(seg.id);
      if (!el) continue;
      const isActive = playheadPosition >= seg.startTime && playheadPosition < seg.startTime + seg.duration;
      if (isActive && !seg.muted) {
        el.currentTime = seg.sourceStart + (playheadPosition - seg.startTime);
        el.volume = seg.volume;
        el.play().catch(() => {});
      }
    }

    rafId = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(rafId);
      // Pause all audio elements on cleanup
      for (const [, el] of audioRefs.current) {
        if (!el.paused) el.pause();
      }
    };
  }, [isPlaying, videoTimeToTimeline]); // Only re-run on play/pause toggle

  // Scrub seek when paused (user drags playhead)
  useEffect(() => {
    if (isPlaying) return;
    // Video audio
    const video = videoRef.current;
    if (video && activeVideoSegment) {
      video.muted = activeVideoSegment.effects.audioMuted ?? false;
      video.volume = activeVideoSegment.effects.audioVolume ?? 1.0;
    } else if (video) {
      video.muted = true;
    }
    // Audio track seek
    const refs = audioRefs.current;
    for (const seg of audioSegmentsRef.current) {
      const el = refs.get(seg.id);
      if (!el) continue;
      const isActive = playheadPosition >= seg.startTime && playheadPosition < seg.startTime + seg.duration;
      if (isActive) {
        el.currentTime = seg.sourceStart + (playheadPosition - seg.startTime);
      }
    }
  }, [isPlaying, playheadPosition, activeVideoSegment]);

  // Find active segments at current playhead position by track type
  const activeCaptions = useMemo(() => {
    if (!timeline) return [];
    return getTrackSegments(timeline, 'caption')
      .filter(seg => isActiveAtTime(seg, playheadPosition)) as CaptionSegment[];
  }, [timeline, playheadPosition]);

  const activeZoomEffect = useMemo(() => {
    if (!timeline) return null;
    return (getTrackSegments(timeline, 'effect')
      .find(seg => isActiveAtTime(seg, playheadPosition)) as ZoomEffectSegment | undefined) ?? null;
  }, [timeline, playheadPosition]);

  const activeOverlays = useMemo(() => {
    if (!timeline) return [];
    return getTrackSegments(timeline, 'overlay')
      .filter(seg => isActiveAtTime(seg, playheadPosition)) as OverlaySegment[];
  }, [timeline, playheadPosition]);

  // Get overlay sources for all active overlays
  const activeOverlaySources = useMemo(() => {
    if (activeOverlays.length === 0 || !project) return [];
    return activeOverlays
      .map(overlay => ({
        overlay,
        source: project.overlaySources?.find(s => s.id === overlay.overlaySourceId) || null,
      }))
      .filter((item): item is { overlay: OverlaySegment; source: NonNullable<typeof item.source> } => item.source !== null);
  }, [activeOverlays, project]);

  // Find selected overlay segment (for interactive editing)
  const selectedOverlay = useMemo(() => {
    if (!timeline || selectedSegmentIds.length === 0) return null;
    return (getTrackSegments(timeline, 'overlay')
      .find(seg => selectedSegmentIds.includes(seg.id)) as OverlaySegment | undefined) ?? null;
  }, [timeline, selectedSegmentIds]);

  // Sync all active overlay videos with playhead
  useEffect(() => {
    const refs = overlayVideoRefs.current;
    for (const overlay of activeOverlays) {
      const overlayVideo = refs.get(overlay.id);
      if (!overlayVideo) continue;
      const overlayTime = overlay.sourceStart + (playheadPosition - overlay.startTime);
      const diff = Math.abs(overlayVideo.currentTime - overlayTime);
      if (diff > 0.05) {
        overlayVideo.currentTime = overlayTime;
      }
    }
  }, [activeOverlays, playheadPosition]);

  // Play/pause all active overlays in lockstep with main video
  useEffect(() => {
    const refs = overlayVideoRefs.current;
    for (const overlay of activeOverlays) {
      const overlayVideo = refs.get(overlay.id);
      if (!overlayVideo) continue;
      if (isPlaying && overlayVideo.paused) {
        overlayVideo.play().catch(() => {});
      } else if (!isPlaying && !overlayVideo.paused) {
        overlayVideo.pause();
      }
    }
  }, [isPlaying, activeOverlays]);

  // Pause overlay videos that are no longer active
  useEffect(() => {
    const refs = overlayVideoRefs.current;
    const activeIds = new Set(activeOverlays.map(o => o.id));
    for (const [id, video] of refs) {
      if (!activeIds.has(id) && !video.paused) {
        video.pause();
      }
    }
  }, [activeOverlays]);

  // Calculate animated zoom value with easing (matches FFmpeg export)
  const animatedZoom = useMemo(() => {
    if (!activeZoomEffect) return null;

    const { startTime, duration, zoom, centerX, centerY } = activeZoomEffect;
    const zoomInDuration = activeZoomEffect.zoomInDuration ?? 0.3;
    const zoomOutDuration = activeZoomEffect.zoomOutDuration ?? 0.3;
    const effectEnd = startTime + duration;
    const zoomInEnd = startTime + zoomInDuration;
    const zoomOutStart = Math.max(zoomInEnd, effectEnd - zoomOutDuration);

    // Smoothstep easing function: t*t*(3-2*t)
    const smoothstep = (t: number) => t * t * (3 - 2 * t);

    let currentZoom = 1;

    if (playheadPosition < startTime) {
      currentZoom = 1;
    } else if (playheadPosition < zoomInEnd && zoomInDuration > 0) {
      const progress = (playheadPosition - startTime) / zoomInDuration;
      const eased = smoothstep(Math.min(1, Math.max(0, progress)));
      currentZoom = 1 + (zoom - 1) * eased;
    } else if (playheadPosition < zoomOutStart) {
      currentZoom = zoom;
    } else if (playheadPosition < effectEnd && zoomOutDuration > 0) {
      const progress = (playheadPosition - zoomOutStart) / zoomOutDuration;
      const eased = smoothstep(Math.min(1, Math.max(0, progress)));
      currentZoom = zoom - (zoom - 1) * eased;
    } else {
      currentZoom = 1;
    }

    return {
      zoom: currentZoom,
      centerX,
      centerY,
    };
  }, [activeZoomEffect, playheadPosition]);

  // Find selected zoom effect segment (for interactive editing)
  const selectedZoomEffect = useMemo(() => {
    if (!timeline || selectedSegmentIds.length === 0) return null;
    return (getTrackSegments(timeline, 'effect')
      .find(seg => seg.type === 'zoom' && selectedSegmentIds.includes(seg.id)) as ZoomEffectSegment | undefined) ?? null;
  }, [timeline, selectedSegmentIds]);


  // Handle zoom box drag start
  const handleZoomBoxMouseDown = useCallback((
    e: React.MouseEvent,
    type: 'move' | 'resize',
    corner?: 'tl' | 'tr' | 'bl' | 'br'
  ) => {
    if (!selectedZoomEffect) return;
    e.preventDefault();
    e.stopPropagation();

    setZoomDragState({
      type,
      startX: e.clientX,
      startY: e.clientY,
      startCenterX: selectedZoomEffect.centerX,
      startCenterY: selectedZoomEffect.centerY,
      startZoom: selectedZoomEffect.zoom,
      corner,
    });
  }, [selectedZoomEffect]);

  // Handle zoom box drag
  useEffect(() => {
    if (!zoomDragState || !videoBounds || !selectedZoomEffect) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - zoomDragState.startX) / videoBounds.width;
      const deltaY = (e.clientY - zoomDragState.startY) / videoBounds.height;

      if (zoomDragState.type === 'move') {
        const newCenterX = Math.max(0, Math.min(1, zoomDragState.startCenterX + deltaX));
        const newCenterY = Math.max(0, Math.min(1, zoomDragState.startCenterY + deltaY));
        updateZoomEffect(selectedZoomEffect.id, { centerX: newCenterX, centerY: newCenterY });
      } else if (zoomDragState.type === 'resize') {
        let sizeDelta = 0;
        switch (zoomDragState.corner) {
          case 'br':
            sizeDelta = -(deltaX + deltaY) / 2;
            break;
          case 'bl':
            sizeDelta = -(-deltaX + deltaY) / 2;
            break;
          case 'tr':
            sizeDelta = -(deltaX - deltaY) / 2;
            break;
          case 'tl':
            sizeDelta = -(-deltaX - deltaY) / 2;
            break;
        }
        const zoomChange = sizeDelta * zoomDragState.startZoom * 2;
        const newZoom = Math.max(1.1, Math.min(4, zoomDragState.startZoom + zoomChange));
        updateZoomEffect(selectedZoomEffect.id, { zoom: newZoom });
      }
    };

    const handleMouseUp = () => {
      useTimelineStore.getState().saveHistory();
      setZoomDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoomDragState, videoBounds, selectedZoomEffect, updateZoomEffect]);

  // Handle overlay box drag start
  const handleOverlayMouseDown = useCallback((
    e: React.MouseEvent,
    overlay: OverlaySegment,
    type: 'move' | 'resize',
    corner?: 'tl' | 'tr' | 'bl' | 'br'
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Select this overlay if it isn't already
    if (!selectedSegmentIds.includes(overlay.id)) {
      useTimelineStore.getState().selectSegment(overlay.id);
    }

    setOverlayDragState({
      overlayId: overlay.id,
      type,
      startX: e.clientX,
      startY: e.clientY,
      startPosition: { ...overlay.position },
      corner,
    });
  }, [selectedSegmentIds]);

  // Get frame aspect ratio for selected overlay (for aspect-locked resize)
  // Adjusted for video dimensions: since pos.width/height are fractions of different dimensions,
  // the "normalized aspect" = frameAspect / videoAspect so that newH = newW / normalizedAspect works correctly
  const selectedOverlayFrameAspect = useMemo(() => {
    if (!selectedOverlay?.deviceFrameId || !videoBounds) return null;
    const frame = DEVICE_FRAME_PRESETS.find(f => f.id === selectedOverlay.deviceFrameId);
    if (!frame) return null;
    const videoAspect = videoBounds.width / videoBounds.height;
    return (frame.width / frame.height) / videoAspect;
  }, [selectedOverlay, videoBounds]);

  // Handle overlay drag
  useEffect(() => {
    if (!overlayDragState || !videoBounds) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - overlayDragState.startX) / videoBounds.width;
      const deltaY = (e.clientY - overlayDragState.startY) / videoBounds.height;

      if (overlayDragState.type === 'move') {
        const newX = Math.max(0, Math.min(1 - overlayDragState.startPosition.width, overlayDragState.startPosition.x + deltaX));
        const newY = Math.max(0, Math.min(1 - overlayDragState.startPosition.height, overlayDragState.startPosition.y + deltaY));
        updateOverlaySegment(overlayDragState.overlayId, {
          position: { ...overlayDragState.startPosition, x: newX, y: newY },
        });
      } else if (overlayDragState.type === 'resize') {
        const pos = overlayDragState.startPosition;
        let newX = pos.x, newY = pos.y, newW = pos.width, newH = pos.height;

        if (selectedOverlayFrameAspect) {
          // Aspect-locked resize: use the dominant drag axis to drive both dimensions
          const absDX = Math.abs(deltaX);
          const absDY = Math.abs(deltaY);
          const useX = absDX >= absDY;

          if (overlayDragState.corner === 'br') {
            if (useX) {
              newW = Math.max(0.05, Math.min(1 - pos.x, pos.width + deltaX));
            } else {
              newW = Math.max(0.05, Math.min(1 - pos.x, pos.width + deltaY * selectedOverlayFrameAspect));
            }
            newH = newW / selectedOverlayFrameAspect;
          } else if (overlayDragState.corner === 'bl') {
            if (useX) {
              const dx = Math.min(deltaX, pos.width - 0.05);
              newW = pos.width - dx;
            } else {
              newW = Math.max(0.05, pos.width + deltaY * selectedOverlayFrameAspect);
            }
            newH = newW / selectedOverlayFrameAspect;
            newX = pos.x + (pos.width - newW);
          } else if (overlayDragState.corner === 'tr') {
            if (useX) {
              newW = Math.max(0.05, Math.min(1 - pos.x, pos.width + deltaX));
            } else {
              newW = Math.max(0.05, Math.min(1 - pos.x, pos.width - deltaY * selectedOverlayFrameAspect));
            }
            newH = newW / selectedOverlayFrameAspect;
            newY = pos.y + (pos.height - newH);
          } else if (overlayDragState.corner === 'tl') {
            if (useX) {
              const dx = Math.min(deltaX, pos.width - 0.05);
              newW = pos.width - dx;
            } else {
              newW = Math.max(0.05, pos.width - deltaY * selectedOverlayFrameAspect);
            }
            newH = newW / selectedOverlayFrameAspect;
            newX = pos.x + (pos.width - newW);
            newY = pos.y + (pos.height - newH);
          }

          // Clamp: ensure height stays within video bounds
          const maxH = overlayDragState.corner?.includes('t') ? pos.y + pos.height : 1 - pos.y;
          if (newH > maxH) {
            newH = maxH;
            newW = newH * selectedOverlayFrameAspect;
            if (overlayDragState.corner?.includes('l')) {
              newX = pos.x + (pos.width - newW);
            }
            if (overlayDragState.corner?.includes('t')) {
              newY = pos.y + (pos.height - newH);
            }
          }
        } else {
          // Free resize (no device frame)
          if (overlayDragState.corner?.includes('r')) {
            newW = Math.max(0.05, Math.min(1 - pos.x, pos.width + deltaX));
          }
          if (overlayDragState.corner?.includes('l')) {
            const dx = Math.min(deltaX, pos.width - 0.05);
            newX = pos.x + dx;
            newW = pos.width - dx;
          }
          if (overlayDragState.corner?.includes('b')) {
            newH = Math.max(0.05, Math.min(1 - pos.y, pos.height + deltaY));
          }
          if (overlayDragState.corner?.includes('t')) {
            const dy = Math.min(deltaY, pos.height - 0.05);
            newY = pos.y + dy;
            newH = pos.height - dy;
          }
        }

        updateOverlaySegment(overlayDragState.overlayId, {
          position: { x: newX, y: newY, width: newW, height: newH },
        });
      }
    };

    const handleMouseUp = () => {
      useTimelineStore.getState().saveHistory();
      setOverlayDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [overlayDragState, videoBounds, selectedOverlayFrameAspect, updateOverlaySegment]);

  // Handle click on video for zoom picking or deselecting overlay
  const handleVideoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isZoomPicking && videoBounds) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left - (rect.width - videoBounds.width) / 2) / videoBounds.width;
      const y = (e.clientY - rect.top - (rect.height - videoBounds.height) / 2) / videoBounds.height;

      const clampedX = Math.max(0, Math.min(1, x));
      const clampedY = Math.max(0, Math.min(1, y));

      setZoomCenter(clampedX, clampedY);
      return;
    }

    // Click on empty preview area deselects overlay
    if (selectedOverlay) {
      useTimelineStore.getState().selectSegment(null);
    }
  }, [isZoomPicking, videoBounds, setZoomCenter, selectedOverlay]);

  // Cancel zoom picking on Escape
  useEffect(() => {
    if (!isZoomPicking) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopZoomPicking();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZoomPicking, stopZoomPicking]);

  if (!source || !timeline) {
    return (
      <div className="h-full flex items-center justify-center text-terminal-muted">
        No video loaded
      </div>
    );
  }

  // Construct video URL - use ID-based filename, not original filename
  const ext = source.filename.split('.').pop() || 'mp4';
  const videoUrl = `/uploads/${source.id}.${ext}`;

  return (
    <div className="h-full w-full flex flex-col bg-terminal-bg">
      {/* Zoom picking mode indicator */}
      {isZoomPicking && (
        <div className="absolute top-0 left-0 right-0 bg-accent-amber/90 text-black text-center py-2 text-sm font-bold z-50">
          Click on the video to set zoom center • Press ESC to cancel
        </div>
      )}

      {/* Video container with caption overlay */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4" ref={videoWrapperRef}>
        <div
          className={`relative flex items-center justify-center ${isZoomPicking ? 'cursor-crosshair' : ''}`}
          style={{ width: '100%', height: '100%' }}
          onMouseDown={handleVideoClick}
        >
          {/* Video container - centers video and clips zoom overflow */}
          <div
            className="relative flex items-center justify-center"
            ref={containerRef}
            style={{ width: '100%', height: '100%' }}
          >
            <div style={{
              overflow: 'hidden',
              lineHeight: 0,
              ...(videoBounds
                ? { width: videoBounds.width, height: videoBounds.height }
                : { maxWidth: '100%', maxHeight: '100%' }),
            }}>
              <video
                ref={videoRef}
                src={videoUrl}
                onLoadedMetadata={handleLoadedMetadata}
                onError={handleError}
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  // Apply zoom: translate to center the zoom point, then scale
                  // overflow:hidden on parent clips the transformed content
                  ...(animatedZoom && !selectedZoomEffect ? (() => {
                    const z = animatedZoom.zoom;
                    const cx = animatedZoom.centerX;
                    const cy = animatedZoom.centerY;
                    const tx = Math.max((1 - z) * 100, Math.min(0, (0.5 - cx * z) * 100));
                    const ty = Math.max((1 - z) * 100, Math.min(0, (0.5 - cy * z) * 100));
                    return {
                      transform: `translate(${tx}%, ${ty}%) scale(${z})`,
                      transformOrigin: '0 0',
                    };
                  })() : {}),
                }}
              />
            </div>
          </div>

          {/* Interactive zoom box - when zoom effect is selected (no zoom transform applied) */}
          {selectedZoomEffect && (() => {
            const vb = getVideoBounds() || videoBounds;
            if (!vb) return null;
            return (
            <div
              className="absolute border-2 border-accent-magenta cursor-move"
              style={{
                width: vb.width / selectedZoomEffect.zoom,
                height: vb.height / selectedZoomEffect.zoom,
                left: `calc(50% - ${vb.width / 2}px + ${selectedZoomEffect.centerX * vb.width - (vb.width / selectedZoomEffect.zoom) / 2}px)`,
                top: `calc(50% - ${vb.height / 2}px + ${selectedZoomEffect.centerY * vb.height - (vb.height / selectedZoomEffect.zoom) / 2}px)`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              }}
              onMouseDown={(e) => handleZoomBoxMouseDown(e, 'move')}
            >
              {/* Label */}
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-accent-magenta text-black text-xs px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
                {selectedZoomEffect.zoom.toFixed(1)}x zoom
              </div>
              {/* Resize handles */}
              {['tl', 'tr', 'bl', 'br'].map((corner) => (
                <div
                  key={corner}
                  className="absolute w-3 h-3 bg-accent-magenta border border-black"
                  style={{
                    cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                    top: corner.includes('t') ? -6 : 'auto',
                    bottom: corner.includes('b') ? -6 : 'auto',
                    left: corner.includes('l') ? -6 : 'auto',
                    right: corner.includes('r') ? -6 : 'auto',
                  }}
                  onMouseDown={(e) => handleZoomBoxMouseDown(e, 'resize', corner as 'tl' | 'tr' | 'bl' | 'br')}
                />
              ))}
            </div>
            );
          })()}

          {/* Zoom picking crosshair */}
          {isZoomPicking && videoBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                width: videoBounds.width,
                height: videoBounds.height,
              }}
            >
              <div className="absolute inset-0 border-2 border-dashed border-accent-amber animate-pulse" />
            </div>
          )}

          {/* Caption overlay - OUTSIDE zoom transform, stays fixed, above overlays */}
          {videoBounds && activeCaptions.length > 0 && (
            <div
              className="absolute pointer-events-none"
              style={{
                width: videoBounds.width,
                height: videoBounds.height,
                zIndex: 20,
              }}
            >
              {activeCaptions.map(caption => (
                <CaptionOverlay key={caption.id} caption={caption} videoBounds={videoBounds} sourceHeight={source?.height || 1080} />
              ))}
            </div>
          )}

          {/* Overlay videos */}
          {videoBounds && activeOverlaySources.map(({ overlay, source: overlaySource }) => {
            const isSelected = selectedOverlay?.id === overlay.id;
            const pos = overlay.position;
            const frame = overlay.deviceFrameId
              ? DEVICE_FRAME_PRESETS.find(f => f.id === overlay.deviceFrameId) || null
              : null;

            const overlayExt = overlaySource.filename.split('.').pop() || 'mp4';
            const overlayUrl = `/uploads/${overlaySource.id}.${overlayExt}`;

            return (
              <div
                key={overlay.id}
                className="absolute cursor-move"
                style={{
                  left: `calc(50% - ${videoBounds.width / 2}px + ${pos.x * videoBounds.width}px)`,
                  top: `calc(50% - ${videoBounds.height / 2}px + ${pos.y * videoBounds.height}px)`,
                  width: pos.width * videoBounds.width,
                  height: pos.height * videoBounds.height,
                  opacity: overlay.opacity,
                  zIndex: 15,
                }}
                onMouseDown={(e) => handleOverlayMouseDown(e, overlay, 'move')}
              >
                {/* Overlay video element */}
                <video
                  ref={(el) => {
                    if (el) overlayVideoRefs.current.set(overlay.id, el);
                    else overlayVideoRefs.current.delete(overlay.id);
                  }}
                  src={overlayUrl}
                  muted
                  playsInline
                  style={frame ? {
                    position: 'absolute',
                    top: `${(frame.screenInset.top / frame.height) * 100}%`,
                    left: `${(frame.screenInset.left / frame.width) * 100}%`,
                    width: `${(frame.screenInset.width / frame.width) * 100}%`,
                    height: `${(frame.screenInset.height / frame.height) * 100}%`,
                    objectFit: 'cover',
                    borderRadius: '15.5% / 7.1%',
                  } : {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: overlay.borderRadius,
                  }}
                />
                {frame && (
                  <DynamicIsland
                    frame={frame}
                    style={{ zIndex: 1 }}
                  />
                )}
                {frame && (
                  <img
                    src={frame.imagePath}
                    alt={frame.name}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 2 }}
                  />
                )}
                {isSelected && (
                  <>
                    <div className="absolute inset-0 border-2 border-accent-green rounded pointer-events-none" style={{ zIndex: 3 }} />
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-accent-green text-black text-xs px-2 py-0.5 rounded whitespace-nowrap pointer-events-none" style={{ zIndex: 3 }}>
                      Overlay
                    </div>
                    {['tl', 'tr', 'bl', 'br'].map((corner) => (
                      <div
                        key={corner}
                        className="absolute w-3 h-3 bg-accent-green border border-black"
                        style={{
                          zIndex: 4,
                          cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                          top: corner.includes('t') ? -6 : 'auto',
                          bottom: corner.includes('b') ? -6 : 'auto',
                          left: corner.includes('l') ? -6 : 'auto',
                          right: corner.includes('r') ? -6 : 'auto',
                        }}
                        onMouseDown={(e) => handleOverlayMouseDown(e, overlay, 'resize', corner as 'tl' | 'tr' | 'bl' | 'br')}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}

          {/* Zoom indicator during playback */}
          {animatedZoom && animatedZoom.zoom > 1.01 && !selectedZoomEffect && (
            <div className="absolute top-2 right-2 bg-accent-magenta text-black text-xs px-2 py-1 rounded pointer-events-none">
              {animatedZoom.zoom.toFixed(1)}x
            </div>
          )}
        </div>
      </div>

      {/* Hidden audio elements for audio track (render all, not just active) */}
      {allAudioSegments.map(audioSeg => {
        const audioSource = project?.audioSources?.find(s => s.id === audioSeg.audioSourceId);
        if (!audioSource) return null;
        const audioExt = audioSource.filename.split('.').pop() || 'mp3';
        const audioUrl = `/uploads/${audioSource.id}.${audioExt}`;
        return (
          <audio
            key={audioSeg.id}
            ref={(el) => {
              if (el) audioRefs.current.set(audioSeg.id, el);
              else audioRefs.current.delete(audioSeg.id);
            }}
            src={audioUrl}
            preload="auto"
          />
        );
      })}

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-2 pb-4">
        <button
          onClick={handleJumpToStart}
          className="btn p-2"
          title="Jump to start (Home)"
        >
          <JumpStartIcon />
        </button>
        <button
          onClick={() => handleFrameStep(-1)}
          className="btn p-2"
          title="Previous frame (←)"
        >
          <FrameBackIcon />
        </button>
        <button
          onClick={handlePlayPause}
          className="btn-primary p-3"
          title="Play/Pause (Space)"
        >
          {timeline.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          onClick={() => handleFrameStep(1)}
          className="btn p-2"
          title="Next frame (→)"
        >
          <FrameForwardIcon />
        </button>
        <button
          onClick={handleJumpToEnd}
          className="btn p-2"
          title="Jump to end (End)"
        >
          <JumpEndIcon />
        </button>
      </div>
    </div>
  );
}

// Icons
function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2l10 6-10 6V2z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 2h4v12H3V2zm6 0h4v12H9V2z" />
    </svg>
  );
}

function FrameBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M10 2l-6 6 6 6V2z" />
    </svg>
  );
}

function FrameForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2l6 6-6 6V2z" />
    </svg>
  );
}

function JumpStartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h2v12H2V2zm4 6l8-6v12l-8-6z" />
    </svg>
  );
}

function JumpEndIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 2h2v12h-2V2zM2 2l8 6-8 6V2z" />
    </svg>
  );
}

interface CaptionOverlayProps {
  caption: CaptionSegment;
  videoBounds: { width: number; height: number };
  sourceHeight: number;
}

function CaptionOverlay({ caption, videoBounds, sourceHeight }: CaptionOverlayProps) {
  const { style, text } = caption;

  // Scale relative to actual source resolution so font sizes match export proportions
  const scaleFactor = videoBounds.height / (sourceHeight || 1080);

  let justifyContent: React.CSSProperties['justifyContent'];
  switch (style.position.horizontal) {
    case 'left':
      justifyContent = 'flex-start';
      break;
    case 'right':
      justifyContent = 'flex-end';
      break;
    default:
      justifyContent = 'center';
  }

  const positionStyles: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent,
    padding: `0 ${16 * scaleFactor}px`,
  };

  const scaledOffset = (style.position.offsetY ?? 20) * scaleFactor;
  if (style.position.vertical === 'top') {
    positionStyles.top = scaledOffset;
  } else if (style.position.vertical === 'bottom') {
    positionStyles.bottom = scaledOffset;
  } else {
    positionStyles.top = '50%';
    positionStyles.transform = 'translateY(-50%)';
  }

  const scaledFontSize = Math.max(10, style.fontSize * scaleFactor);
  const scaledPadding = (style.padding ?? 10) * scaleFactor;
  const bgOpacityHex = Math.round((style.backgroundOpacity ?? 0.7) * 255).toString(16).padStart(2, '0');

  const textStyles: React.CSSProperties = {
    fontSize: `${scaledFontSize}px`,
    fontFamily: style.fontFamily || 'Arial, sans-serif',
    color: style.fontColor || '#ffffff',
    backgroundColor: `${style.backgroundColor || '#000000'}${bgOpacityHex}`,
    padding: `${scaledPadding * 0.5}px ${scaledPadding}px`,
    borderRadius: `${(style.padding ?? 10) * 1.2 * scaleFactor}px`,
    textAlign: 'center',
    maxWidth: '90%',
    wordWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.2,
  };

  return (
    <div style={positionStyles}>
      <span style={textStyles}>{text}</span>
    </div>
  );
}

// iOS status bar overlay for device frames
function DynamicIsland({ frame, style: extraStyle }: { frame: DeviceFrame; style?: React.CSSProperties }) {
  // Position the Dynamic Island at the top-center of the screen area
  const screenTop = (frame.screenInset.top / frame.height) * 100;
  const screenLeft = (frame.screenInset.left / frame.width) * 100;
  const screenWidth = (frame.screenInset.width / frame.width) * 100;
  const screenHeight = (frame.screenInset.height / frame.height) * 100;

  // Dynamic Island: ~30% of screen width, ~3.5% of screen height, centered near top
  const islandWidthPct = 30;
  const islandHeightPct = 3.5;
  const islandTopPct = 1; // offset from top of screen

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: `${screenTop + screenHeight * islandTopPct / 100}%`,
        left: `${screenLeft + screenWidth * (50 - islandWidthPct / 2) / 100}%`,
        width: `${screenWidth * islandWidthPct / 100}%`,
        height: `${screenHeight * islandHeightPct / 100}%`,
        backgroundColor: '#000',
        borderRadius: '999px',
        minHeight: 4,
        ...extraStyle,
      }}
    />
  );
}
