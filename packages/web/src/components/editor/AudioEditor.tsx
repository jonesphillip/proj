import { useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { formatTime } from '../../utils/format';
import { Slider } from '../ui/Slider';
import { SpeakerIcon, SpeakerMutedIcon } from '../ui/Icons';
import type { AudioSegment } from '@proj/shared';

interface AudioEditorProps {
  segment: AudioSegment;
}

export function AudioEditor({ segment }: AudioEditorProps) {
  const { updateAudioSegment, saveHistory, project } = useTimelineStore();

  const audioSource = project?.audioSources?.find(s => s.id === segment.audioSourceId);

  const handleVolumeChange = useCallback((value: number) => {
    updateAudioSegment(segment.id, { volume: value });
  }, [segment.id, updateAudioSegment]);

  const handleMuteToggle = useCallback(() => {
    updateAudioSegment(segment.id, { muted: !segment.muted });
    saveHistory();
  }, [segment.id, segment.muted, updateAudioSegment, saveHistory]);

  const handleFadeInChange = useCallback((value: number) => {
    updateAudioSegment(segment.id, { fadeInDuration: value });
  }, [segment.id, updateAudioSegment]);

  const handleFadeOutChange = useCallback((value: number) => {
    updateAudioSegment(segment.id, { fadeOutDuration: value });
  }, [segment.id, updateAudioSegment]);

  return (
    <div className="mb-4">
      <h3 className="text-xs font-bold text-terminal-muted mb-2">Audio</h3>

      <div className="panel p-3 space-y-3">
        {/* Source info */}
        {audioSource && (
          <div className="text-xs text-terminal-muted space-y-0.5">
            <div className="truncate">{audioSource.filename}</div>
            <div>Duration: {formatTime(audioSource.duration)}</div>
            <div>Range: {formatTime(segment.sourceStart)} - {formatTime(segment.sourceEnd)}</div>
          </div>
        )}

        {/* Volume + Mute */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-accent-blue">{Math.round(segment.volume * 100)}%</span>
          <button
            onClick={handleMuteToggle}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              segment.muted
                ? 'border-accent-red text-accent-red bg-accent-red/10'
                : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
            }`}
          >
            {segment.muted ? <><SpeakerMutedIcon /> Muted</> : <><SpeakerIcon /> On</>}
          </button>
        </div>

        <div className={segment.muted ? 'opacity-40 pointer-events-none' : ''}>
          <Slider
            value={segment.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={handleVolumeChange}
            onChangeEnd={saveHistory}
            color="#3b82f6"
          />
        </div>

        {/* Fade controls */}
        <div className="space-y-2 pt-2 border-t border-terminal-border">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-terminal-muted">Fade In</span>
              <span className="text-xs text-accent-blue">{segment.fadeInDuration.toFixed(1)}s</span>
            </div>
            <Slider
              value={segment.fadeInDuration}
              min={0}
              max={5}
              step={0.1}
              onChange={handleFadeInChange}
              onChangeEnd={saveHistory}
              color="#3b82f6"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-terminal-muted">Fade Out</span>
              <span className="text-xs text-accent-blue">{segment.fadeOutDuration.toFixed(1)}s</span>
            </div>
            <Slider
              value={segment.fadeOutDuration}
              min={0}
              max={5}
              step={0.1}
              onChange={handleFadeOutChange}
              onChangeEnd={saveHistory}
              color="#3b82f6"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
