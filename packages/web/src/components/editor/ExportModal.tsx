import { useState, useCallback, useEffect, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { useTimelineStore } from '../../stores/timeline';
import type { ExportPreset, ExportProgress, AspectRatio, Timeline, ExportRecord } from '@proj/shared';
import { EXPORT_PRESETS, QUALITY_BITRATES, ASPECT_RATIO_OPTIONS } from '@proj/shared';

const QUALITY_INFO: Record<string, { crf: string; preset: string; description: string }> = {
  high: { crf: '12', preset: 'veryslow', description: 'Virtually lossless (CRF 12), slow export' },
  medium: { crf: '18', preset: 'medium', description: 'Excellent quality (CRF 18), balanced' },
  low: { crf: '24', preset: 'fast', description: 'Good quality (CRF 24), fast export' },
};

interface ExportModalProps {
  onClose: () => void;
}

type ExportState = 'settings' | 'exporting' | 'complete' | 'error';
type ModalTab = 'new' | 'history';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }) + ', ' + date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function ExportModal({ onClose }: ExportModalProps) {
  const { project, setExportSettings, addExportRecord } = useTimelineStore();
  const [exportState, setExportState] = useState<ExportState>('settings');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<ModalTab>('new');

  const settings = project?.exportSettings;
  const source = project?.source;
  const exports = project?.exports || [];

  const effectiveSettings = useMemo(() => {
    if (!settings || !source) return settings;
    let result = { ...settings };

    if (settings.useSourceResolution) {
      let bitrate = source.bitrate;
      if (!bitrate || bitrate === 0) {
        if (source.height >= 1080) bitrate = 8000000;
        else if (source.height >= 720) bitrate = 4000000;
        else bitrate = 2000000;
      }
      const maxBitrate = source.height >= 1080 ? 12000000 : source.height >= 720 ? 6000000 : 3000000;
      bitrate = Math.min(bitrate, maxBitrate);

      result = {
        ...result,
        width: source.width,
        height: source.height,
        fps: source.fps,
        bitrate,
      };
    }

    const aspectRatio = settings.aspectRatio || 'source';
    if (aspectRatio === 'source') {
      if (source && !settings.useSourceResolution) {
        const sourceRatio = source.width / source.height;
        if (sourceRatio >= 1) {
          result.width = Math.round(result.height * sourceRatio);
        } else {
          result.height = Math.round(result.width / sourceRatio);
        }
        if (result.width % 2 !== 0) result.width += 1;
        if (result.height % 2 !== 0) result.height += 1;
      }
    } else {
      const ratioOption = ASPECT_RATIO_OPTIONS.find(o => o.value === aspectRatio);
      if (ratioOption?.ratio) {
        const baseSize = Math.max(result.width, result.height);
        if (ratioOption.ratio >= 1) {
          result.width = baseSize;
          result.height = Math.round(baseSize / ratioOption.ratio);
        } else {
          result.height = baseSize;
          result.width = Math.round(baseSize * ratioOption.ratio);
        }
        if (result.width % 2 !== 0) result.width += 1;
        if (result.height % 2 !== 0) result.height += 1;
      }
    }

    return result;
  }, [settings, source]);

  const handlePresetChange = useCallback((preset: ExportPreset) => {
    if (!source) return;
    const presetSettings = EXPORT_PRESETS[preset];

    if (preset === 'source-high') {
      setExportSettings({
        preset,
        ...presetSettings,
        width: source.width,
        height: source.height,
        fps: source.fps,
      });
    } else {
      setExportSettings({
        preset,
        ...presetSettings,
      });
    }
  }, [setExportSettings, source]);

  const handleQualityChange = useCallback((quality: 'high' | 'medium' | 'low') => {
    if (!settings || !effectiveSettings) return;

    let tier: '1080p' | '720p' | '480p' = '720p';
    if (effectiveSettings.height >= 1080) tier = '1080p';
    else if (effectiveSettings.height >= 720) tier = '720p';
    else tier = '480p';

    const bitrate = QUALITY_BITRATES[quality][tier];
    setExportSettings({ quality, bitrate });
  }, [settings, effectiveSettings, setExportSettings]);

  const handleAspectRatioChange = useCallback((ratio: AspectRatio) => {
    setExportSettings({ aspectRatio: ratio });
  }, [setExportSettings]);

  const handleExport = useCallback(async () => {
    if (!project || !effectiveSettings) return;

    setExportState('exporting');
    setProgress({ status: 'preparing', progress: 0 });

    try {
      const exportProject = {
        ...project,
        exportSettings: effectiveSettings,
      };

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: exportProject }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Export failed');
      }

      const pollProgress = async () => {
        const statusResponse = await fetch(`/api/export/${result.jobId}`);
        const status = await statusResponse.json();

        setProgress({
          status: status.status,
          progress: status.progress,
          outputPath: status.outputPath,
          error: status.error,
        });

        if (status.status === 'complete') {
          setExportState('complete');
          setDownloadUrl(status.outputPath);

          const record: ExportRecord = {
            id: nanoid(),
            timestamp: Date.now(),
            path: status.outputPath,
            width: effectiveSettings.width,
            height: effectiveSettings.height,
            quality: effectiveSettings.quality,
            aspectRatio: effectiveSettings.aspectRatio,
            fileSize: status.fileSize,
          };
          addExportRecord(record);
        } else if (status.status === 'error') {
          setExportState('error');
        } else {
          setTimeout(pollProgress, 500);
        }
      };

      pollProgress();
    } catch (error) {
      setExportState('error');
      setProgress({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : 'Export failed',
      });
    }
  }, [project, effectiveSettings, addExportRecord]);

  const handleDownload = useCallback(() => {
    if (downloadUrl) {
      triggerDownload(downloadUrl, `${project?.name || 'video'}_export.mp4`);
    }
  }, [downloadUrl, project?.name]);

  const handleHistoryDownload = useCallback((record: ExportRecord) => {
    triggerDownload(record.path, `${project?.name || 'video'}_export.mp4`);
  }, [project?.name]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && exportState !== 'exporting') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exportState, onClose]);

  if (!project || !settings) return null;

  const showTabs = exportState === 'settings';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="panel p-6 w-full max-w-md h-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-accent-primary">Export Video</h2>
          {exportState !== 'exporting' && (
            <button
              onClick={onClose}
              className="text-terminal-muted hover:text-terminal-text"
            >
              ✕
            </button>
          )}
        </div>

        {showTabs && (
          <div className="flex gap-4 mb-4 border-b border-terminal-border">
            <button
              onClick={() => setTab('new')}
              className={`pb-2 text-sm transition-colors relative ${
                tab === 'new'
                  ? 'text-accent-primary'
                  : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              New
              {tab === 'new' && <span className="absolute bottom-0 left-0 right-0 h-px bg-accent-primary" />}
            </button>
            <button
              onClick={() => setTab('history')}
              className={`pb-2 text-sm transition-colors relative ${
                tab === 'history'
                  ? 'text-accent-primary'
                  : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              History{exports.length > 0 && ` (${exports.length})`}
              {tab === 'history' && <span className="absolute bottom-0 left-0 right-0 h-px bg-accent-primary" />}
            </button>
          </div>
        )}

        {showTabs && tab === 'new' && effectiveSettings && (
          <div className="flex-1 overflow-y-auto">
            <div className="mb-4">
              <label className="text-xs text-terminal-muted block mb-2">Aspect Ratio</label>
              <div className="flex gap-2">
                {ASPECT_RATIO_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handleAspectRatioChange(value)}
                    className={`flex-1 px-3 py-2 text-sm rounded border transition-colors ${
                      (settings.aspectRatio || 'source') === value
                        ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                        : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-terminal-muted block mb-2">Resolution</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { preset: 'source-high' as ExportPreset, label: `Source (${source?.width}x${source?.height})`, recommended: true },
                  { preset: 'twitter-1080p' as ExportPreset, label: '1080p (Full HD)' },
                  { preset: 'twitter-720p' as ExportPreset, label: '720p (HD)' },
                  { preset: 'twitter-480p' as ExportPreset, label: '480p (SD)' },
                ]).map(({ preset, label, recommended }) => (
                  <button
                    key={preset}
                    onClick={() => handlePresetChange(preset)}
                    className={`px-3 py-2 text-sm rounded border transition-colors ${
                      settings.preset === preset
                        ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                        : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
                    }`}
                  >
                    {label}
                    {recommended && <span className="text-xs text-accent-cyan ml-1">★</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-terminal-muted block mb-2">Quality</label>
              <div className="flex gap-2">
                {(['high', 'medium', 'low'] as const).map(quality => (
                  <button
                    key={quality}
                    onClick={() => handleQualityChange(quality)}
                    className={`flex-1 px-3 py-2 text-sm rounded border transition-colors capitalize ${
                      settings.quality === quality
                        ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                        : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
                    }`}
                  >
                    {quality}
                  </button>
                ))}
              </div>
              <p className="text-xs text-terminal-muted mt-1">
                {QUALITY_INFO[settings.quality].description}
              </p>
            </div>

            <div className="panel p-3 mb-6 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-terminal-muted">Resolution:</span>
                <span>{effectiveSettings.width}x{effectiveSettings.height}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-muted">Frame Rate:</span>
                <span>{effectiveSettings.fps} fps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-muted">Quality Mode:</span>
                <span>
                  CRF {QUALITY_INFO[settings.quality].crf}
                  <span className="text-terminal-muted ml-1">
                    ({QUALITY_INFO[settings.quality].preset} preset)
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-muted">Codec:</span>
                <span>{effectiveSettings.codec.toUpperCase()} High Profile</span>
              </div>
              <AudioStatusRow timeline={project?.timeline} />
            </div>

            <button
              onClick={handleExport}
              className="btn-primary w-full"
            >
              Start Export
            </button>
          </div>
        )}

        {showTabs && tab === 'history' && (
          <div className="flex-1">
            <ExportHistory
              exports={exports}
              projectName={project.name}
              onDownload={handleHistoryDownload}
            />
          </div>
        )}

        {exportState === 'exporting' && progress && (
          <div className="text-center flex-1 flex flex-col justify-center">
            <div className="mb-4">
              <div className="text-4xl font-bold text-accent-primary mb-2">
                {progress.progress}%
              </div>
              <div className="text-sm text-terminal-muted">
                {progress.currentStep || 'Processing...'}
              </div>
            </div>

            <div className="h-2 bg-terminal-bg rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-accent-primary transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>

            <p className="text-xs text-terminal-muted">
              Please wait while your video is being processed...
            </p>
          </div>
        )}

        {exportState === 'complete' && (
          <div className="text-center flex-1 flex flex-col justify-center">
            <div className="text-6xl mb-4">✓</div>
            <h3 className="text-xl font-bold text-accent-primary mb-2">
              Export Complete!
            </h3>
            <p className="text-sm text-terminal-muted mb-6">
              Your video is ready for download.
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleDownload}
                className="btn-primary flex-1"
              >
                Download Video
              </button>
              <button
                onClick={onClose}
                className="btn flex-1"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {exportState === 'error' && (
          <div className="text-center flex-1 flex flex-col justify-center">
            <div className="text-6xl mb-4 text-accent-red">✕</div>
            <h3 className="text-xl font-bold text-accent-red mb-2">
              Export Failed
            </h3>
            <div className="panel p-3 mb-6 max-h-32 overflow-y-auto text-left">
              <p className="text-sm text-terminal-muted break-words whitespace-pre-wrap">
                {progress?.error || 'An unknown error occurred.'}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setExportState('settings')}
                className="btn flex-1"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="btn flex-1"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExportHistory({
  exports,
  projectName,
  onDownload,
}: {
  exports: ExportRecord[];
  projectName: string;
  onDownload: (record: ExportRecord) => void;
}) {
  if (exports.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-terminal-muted">No exports yet.</p>
        <p className="text-xs text-terminal-muted mt-1">
          Export your video to see them listed here.
        </p>
      </div>
    );
  }

  const sorted = [...exports].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {sorted.map(record => (
        <div
          key={record.id}
          className="panel p-3 flex items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm text-terminal-text">
              {formatDate(record.timestamp)}
            </div>
            <div className="text-xs text-terminal-muted mt-0.5">
              {record.width}x{record.height}
              {record.aspectRatio && record.aspectRatio !== 'source' && ` · ${record.aspectRatio}`}
              {' · '}{record.quality.charAt(0).toUpperCase() + record.quality.slice(1)}
              {record.fileSize != null && ` · ${formatFileSize(record.fileSize)}`}
            </div>
          </div>
          <button
            onClick={() => onDownload(record)}
            className="shrink-0 px-2.5 py-1.5 text-xs rounded border border-terminal-border text-terminal-muted hover:border-accent-primary hover:text-accent-primary transition-colors"
            title={`Download ${projectName}_export.mp4`}
          >
            ⤓
          </button>
        </div>
      ))}
    </div>
  );
}

function AudioStatusRow({ timeline }: { timeline: Timeline | undefined }) {
  const videoTrack = timeline?.tracks.find(t => t.type === 'video');
  const hasUnmutedVideo = videoTrack?.segments.some(s => !s.effects.audioMuted) ?? false;
  const audioTrack = timeline?.tracks.find(t => t.type === 'audio');
  const hasAudioSegments = (audioTrack?.segments.length ?? 0) > 0;

  const hasAudio = hasUnmutedVideo || hasAudioSegments;

  let label = 'Muted (silent)';
  if (hasUnmutedVideo && hasAudioSegments) label = 'Source + Background';
  else if (hasUnmutedVideo) label = 'Source audio';
  else if (hasAudioSegments) label = 'Background audio';

  return (
    <div className="flex justify-between">
      <span className="text-terminal-muted">Audio:</span>
      <span className={hasAudio ? 'text-accent-green' : 'text-accent-amber'}>
        {label}
      </span>
    </div>
  );
}
