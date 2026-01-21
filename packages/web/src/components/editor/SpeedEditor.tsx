import { useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { formatTime } from '../../utils/format';
import { Slider } from '../ui/Slider';
import { SpeakerIcon, SpeakerMutedIcon } from '../ui/Icons';
import type { VideoSegment } from '@proj/shared';

interface SpeedEditorProps {
  segment: VideoSegment;
}

const COMMON_SPEEDS = [0.5, 1, 1.5, 2];
const EXTENDED_SPEEDS = [0.25, 0.75, 3, 4, 6, 8, 10];

export function SpeedEditor({ segment }: SpeedEditorProps) {
  const { setSpeedEffect, setAudioEffect, saveHistory } = useTimelineStore();

  const currentSpeed = segment.effects.speed?.rate || 1;
  const effectiveDuration = segment.duration / currentSpeed;
  const isAudioMuted = segment.effects.audioMuted ?? false;
  const audioVolume = segment.effects.audioVolume ?? 1.0;

  const handleSpeedChange = useCallback((rate: number) => {
    setSpeedEffect(segment.id, rate);
  }, [segment.id, setSpeedEffect]);

  const handleMuteToggle = useCallback(() => {
    setAudioEffect(segment.id, !isAudioMuted, audioVolume);
    saveHistory();
  }, [segment.id, isAudioMuted, audioVolume, setAudioEffect, saveHistory]);

  const handleVolumeChange = useCallback((value: number) => {
    setAudioEffect(segment.id, isAudioMuted, value);
  }, [segment.id, isAudioMuted, setAudioEffect]);

  return (
    <div className="mb-4">
      <h3 className="text-xs font-bold text-terminal-muted mb-2">Speed</h3>

      <div className="panel p-3 space-y-3">
        {/* Current speed display */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-accent-primary">{currentSpeed}x</span>
          <span className="text-xs text-terminal-muted">
            {currentSpeed < 1 ? 'Slower' : currentSpeed > 1 ? 'Faster' : 'Normal'}
          </span>
        </div>

        {/* Effective duration */}
        <div className="text-xs text-terminal-muted">
          {formatTime(segment.duration)} source → {formatTime(effectiveDuration)} at {currentSpeed}x
        </div>

        {/* Slider */}
        <Slider
          value={currentSpeed}
          min={0.25}
          max={10}
          step={0.25}
          onChange={handleSpeedChange}
          onChangeEnd={saveHistory}
          color="#9B8EC4"
        />

        {/* Common preset buttons */}
        <div className="grid grid-cols-4 gap-1">
          {COMMON_SPEEDS.map(rate => (
            <button
              key={rate}
              onClick={() => handleSpeedChange(rate)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                currentSpeed === rate
                  ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                  : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Extended speeds */}
        <details className="group">
          <summary className="text-xs text-terminal-muted cursor-pointer hover:text-terminal-text select-none">
            More speeds
          </summary>
          <div className="flex flex-wrap gap-1 mt-2">
            {EXTENDED_SPEEDS.map(rate => (
              <button
                key={rate}
                onClick={() => handleSpeedChange(rate)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  currentSpeed === rate
                    ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                    : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </details>
      </div>

      {/* Audio section */}
      <div className="panel p-3 space-y-3 mt-3 border-t border-terminal-border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-terminal-muted">Audio</span>
          <button
            onClick={handleMuteToggle}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              isAudioMuted
                ? 'border-accent-red text-accent-red bg-accent-red/10'
                : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
            }`}
          >
            {isAudioMuted ? <><SpeakerMutedIcon /> Muted</> : <><SpeakerIcon /> On</>}
          </button>
        </div>

        <div className={isAudioMuted ? 'opacity-40 pointer-events-none' : ''}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-terminal-muted">Volume</span>
            <span className="text-xs text-accent-primary">{Math.round(audioVolume * 100)}%</span>
          </div>
          <Slider
            value={audioVolume}
            min={0}
            max={1}
            step={0.01}
            onChange={handleVolumeChange}
            onChangeEnd={saveHistory}
            color="#06b6d4"
          />
        </div>
      </div>
    </div>
  );
}
