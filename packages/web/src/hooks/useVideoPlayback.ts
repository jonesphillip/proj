import { useRef, useEffect, useCallback, useMemo } from 'react';
import type { VideoSegment, Timeline } from '@proj/shared';

interface UseVideoPlaybackParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSegments: VideoSegment[];
  timeline: Timeline | undefined;
  playheadPosition: number;
  isPlaying: boolean;
  setPlayheadPosition: (position: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
}

interface UseVideoPlaybackResult {
  timelineToSource: (timelinePos: number) => number;
  currentSpeedRate: number;
}

export function useVideoPlayback({
  videoRef,
  videoSegments,
  timeline,
  playheadPosition,
  isPlaying,
  setPlayheadPosition,
  setIsPlaying,
}: UseVideoPlaybackParams): UseVideoPlaybackResult {
  const isSeeking = useRef(false);
  const pendingSeekTime = useRef<number | null>(null);

  const timelineToSource = useCallback((timelinePos: number): number => {
    for (const seg of videoSegments) {
      const segEnd = seg.startTime + seg.duration;
      if (timelinePos >= seg.startTime && timelinePos < segEnd) {
        const relativePos = timelinePos - seg.startTime;
        const speedRate = seg.effects.speed?.rate || 1;
        return seg.sourceStart + (relativePos * speedRate);
      }
    }
    return timelinePos;
  }, [videoSegments]);

  useEffect(() => {
    pendingSeekTime.current = playheadPosition;
  }, [playheadPosition]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !timeline) return;

    if (isPlaying) return;

    const sourceTime = timelineToSource(playheadPosition);
    const diff = Math.abs(video.currentTime - sourceTime);
    if (diff > 0.05) {
      isSeeking.current = true;
      video.currentTime = sourceTime;
    }
  }, [playheadPosition, isPlaying, timeline, timelineToSource, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !timeline) return;

    if (isPlaying && video.paused) {
      const timelinePos = pendingSeekTime.current ?? 0;
      const sourceTime = timelineToSource(timelinePos);

      const handleSeekedOnce = () => {
        video.removeEventListener('seeked', handleSeekedOnce);
        video.play().catch(() => {});
      };

      const diff = Math.abs(video.currentTime - sourceTime);
      if (diff > 0.1) {
        video.addEventListener('seeked', handleSeekedOnce);
        video.currentTime = sourceTime;
      } else {
        video.play().catch(() => {});
      }
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, timeline, timelineToSource, videoRef]);

  const findSegmentAtTimeline = useCallback((timelinePos: number): VideoSegment | null => {
    for (const seg of videoSegments) {
      const segEnd = seg.startTime + seg.duration;
      if (timelinePos >= seg.startTime && timelinePos < segEnd) {
        return seg;
      }
    }
    return null;
  }, [videoSegments]);

  const findNextSegment = useCallback((timelinePos: number, currentSegmentId?: string): VideoSegment | null => {
    const sorted = [...videoSegments].sort((a, b) => a.startTime - b.startTime);
    for (const seg of sorted) {
      if (seg.startTime >= timelinePos - 0.01 && seg.id !== currentSegmentId) {
        return seg;
      }
    }
    return null;
  }, [videoSegments]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!video.paused && !isSeeking.current) {
        const sourceTime = video.currentTime;

        let foundSegment: VideoSegment | null = null;
        for (const seg of videoSegments) {
          if (sourceTime >= seg.sourceStart && sourceTime < seg.sourceEnd) {
            foundSegment = seg;
            break;
          }
        }

        if (foundSegment) {
          const relativeSource = sourceTime - foundSegment.sourceStart;
          const speedRate = foundSegment.effects.speed?.rate || 1;
          const timelinePos = foundSegment.startTime + (relativeSource / speedRate);
          setPlayheadPosition(timelinePos);
        } else {
          // Source time is not in any segment (gap from deleted segment)
          const sortedBySource = [...videoSegments].sort((a, b) => a.sourceStart - b.sourceStart);

          let nextSeg: VideoSegment | null = null;
          let prevSeg: VideoSegment | null = null;

          for (const seg of sortedBySource) {
            if (seg.sourceStart > sourceTime) {
              nextSeg = seg;
              break;
            }
            prevSeg = seg;
          }

          if (nextSeg) {
            isSeeking.current = true;
            video.currentTime = nextSeg.sourceStart;
            setPlayheadPosition(nextSeg.startTime);
          } else if (prevSeg) {
            setPlayheadPosition(prevSeg.startTime + prevSeg.duration);
            setIsPlaying(false);
            video.pause();
          } else {
            setIsPlaying(false);
            video.pause();
          }
        }
      }
    };

    const handleEnded = () => {
      const currentTimeline = pendingSeekTime.current ?? 0;
      const currentSegment = findSegmentAtTimeline(currentTimeline);

      if (currentSegment) {
        const nextSeg = findNextSegment(currentSegment.startTime + currentSegment.duration, currentSegment.id);
        if (nextSeg) {
          isSeeking.current = true;
          video.currentTime = nextSeg.sourceStart;
          setPlayheadPosition(nextSeg.startTime);
          video.play().catch(() => {});
          return;
        }
      }

      setIsPlaying(false);
    };

    const handleSeeked = () => {
      isSeeking.current = false;
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('seeked', handleSeeked);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [setPlayheadPosition, setIsPlaying, videoSegments, findSegmentAtTimeline, findNextSegment, videoRef]);

  const currentVideoSegment = useMemo(() => {
    return videoSegments.find(seg => {
      const start = seg.startTime;
      const end = seg.startTime + seg.duration;
      return playheadPosition >= start && playheadPosition < end;
    }) || null;
  }, [videoSegments, playheadPosition]);

  const currentSpeedRate = useMemo(() => {
    if (!currentVideoSegment) return 1;
    return currentVideoSegment.effects.speed?.rate || 1;
  }, [currentVideoSegment]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Math.abs(video.playbackRate - currentSpeedRate) > 0.01) {
      video.playbackRate = currentSpeedRate;
    }
  }, [currentSpeedRate, videoRef]);

  return {
    timelineToSource,
    currentSpeedRate,
  };
}
