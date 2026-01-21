export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnailUrl: string | null;
  duration: number;
  sourceFilename: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: VideoSource;
  timeline: Timeline;
  exportSettings: ExportSettings;
  overlaySources: OverlaySource[];
  audioSources?: AudioSource[];
  exports?: ExportRecord[];
}

export interface VideoSource {
  id: string;
  filename: string;
  path: string;
  proxyPath?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  thumbnails?: string[];
  waveform?: number[];
}

export interface AudioSource {
  id: string;
  filename: string;
  path: string;
  duration: number;
  waveform?: number[];
}

export interface Timeline {
  duration: number;
  pixelsPerSecond: number;
  scrollOffset: number;
  playheadPosition: number;
  isPlaying: boolean;
  tracks: Track[];
}

export interface Track {
  id: string;
  type: 'video' | 'caption' | 'effect' | 'overlay' | 'audio';
  name: string;
  segments: Segment[];
  muted?: boolean;
  locked?: boolean;
}

export interface Segment {
  id: string;
  trackId: string;
  type: 'video' | 'caption' | 'zoom' | 'overlay' | 'audio';
  startTime: number; // Position on timeline
  duration: number;
  sourceStart?: number; // For video: start time in source video
  sourceEnd?: number; // For video: end time in source video
  effects: Effects;
}

export interface VideoSegment extends Segment {
  type: 'video';
  sourceStart: number;
  sourceEnd: number;
}

export interface CaptionSegment extends Segment {
  type: 'caption';
  text: string;
  style: CaptionStyle;
}

export interface ZoomEffectSegment extends Segment {
  type: 'zoom';
  zoom: number; // 1.0 = 100%, 2.0 = 200%
  centerX: number; // 0-1 normalized
  centerY: number; // 0-1 normalized
  zoomInDuration: number; // seconds for zoom-in animation (0 = instant)
  zoomOutDuration: number; // seconds for zoom-out animation (0 = instant)
}

export interface Effects {
  speed?: SpeedEffect;
  zoom?: ZoomEffect;
  audioMuted?: boolean;
  audioVolume?: number; // 0-1, default 1.0
}

export interface SpeedEffect {
  rate: number; // 0.25 - 4.0
}

export interface ZoomEffect {
  keyframes: ZoomKeyframe[];
}

export interface ZoomKeyframe {
  time: number; // Relative to segment start (0-1 normalized)
  zoom: number; // 1.0 = 100%, 2.0 = 200%
  x: number; // Center X (0-1 normalized)
  y: number; // Center Y (0-1 normalized)
}

export interface CaptionStyle {
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: CaptionPosition;
  padding: number;
}

export interface CaptionPosition {
  vertical: 'top' | 'center' | 'bottom';
  horizontal: 'left' | 'center' | 'right';
  offsetX: number;
  offsetY: number;
}

export type AspectRatio = 'source' | '16:9' | '9:16' | '1:1' | '4:5';

export const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; ratio: number | null }[] = [
  { value: 'source', label: 'Source', ratio: null },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
];

export interface ExportSettings {
  preset: ExportPreset;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: 'h264' | 'h265';
  quality: 'high' | 'medium' | 'low';
  useSourceResolution?: boolean;
  aspectRatio?: AspectRatio;
}

export type ExportPreset = 'source-high' | 'twitter-1080p' | 'twitter-720p' | 'twitter-480p' | 'custom';

export const QUALITY_BITRATES = {
  high: { '1080p': 8000000, '720p': 4000000, '480p': 2000000 },
  medium: { '1080p': 5000000, '720p': 2500000, '480p': 1500000 },
  low: { '1080p': 3000000, '720p': 1500000, '480p': 800000 },
};

export const EXPORT_PRESETS: Record<ExportPreset, Omit<ExportSettings, 'preset'>> = {
  'source-high': {
    width: 0, // Will use source resolution
    height: 0,
    fps: 0, // Will use source fps
    bitrate: 0, // Will use source bitrate or calculate based on resolution
    codec: 'h264',
    quality: 'high',
    useSourceResolution: true,
  },
  'twitter-1080p': {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 8000000,
    codec: 'h264',
    quality: 'high',
  },
  'twitter-720p': {
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 4000000,
    codec: 'h264',
    quality: 'high',
  },
  'twitter-480p': {
    width: 854,
    height: 480,
    fps: 30,
    bitrate: 2000000,
    codec: 'h264',
    quality: 'medium',
  },
  custom: {
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 4000000,
    codec: 'h264',
    quality: 'high',
  },
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 96,  // Extra large for mobile readability
  fontFamily: 'Arial',
  fontColor: '#ffffff',
  backgroundColor: '#666666',
  backgroundOpacity: 0.9,
  position: {
    vertical: 'bottom',
    horizontal: 'center',
    offsetX: 0,
    offsetY: 50,
  },
  padding: 40,  // More padding for larger text
};

export interface OverlaySource {
  id: string;
  filename: string;
  path: string;
  proxyPath?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export interface DeviceFrame {
  id: string;
  name: string;
  imagePath: string;       // path to bundled frame PNG in public/frames/
  width: number;           // frame image width in px
  height: number;          // frame image height in px
  screenInset: { top: number; left: number; width: number; height: number };
}

export interface OverlayPosition {
  x: number;      // 0-1 normalized, left edge
  y: number;      // 0-1 normalized, top edge
  width: number;  // 0-1 fraction of main video width
  height: number; // 0-1 fraction of main video height
}

export interface OverlaySegment extends Segment {
  type: 'overlay';
  overlaySourceId: string;
  sourceStart: number;
  sourceEnd: number;
  position: OverlayPosition;
  deviceFrameId?: string | null;
  opacity: number;        // 0-1, default 1
  borderRadius: number;   // px, default 0
}

export interface AudioSegment extends Segment {
  type: 'audio';
  audioSourceId: string;
  sourceStart: number;
  sourceEnd: number;
  volume: number; // 0-1, default 1.0
  fadeInDuration: number; // seconds, default 0
  fadeOutDuration: number; // seconds, default 0
  muted: boolean;
}

export const DEVICE_FRAME_PRESETS: DeviceFrame[] = [
  {
    id: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    imagePath: '/frames/iphone-17-pro.png',
    width: 1744,
    height: 3632,
    screenInset: { top: 72, left: 72, width: 1601, height: 3489 },
  },
];

export interface ExportRecord {
  id: string;
  timestamp: number;
  path: string;
  width: number;
  height: number;
  quality: 'high' | 'medium' | 'low';
  aspectRatio?: AspectRatio;
  fileSize?: number;
}

export interface ExportProgress {
  status: 'preparing' | 'processing' | 'complete' | 'error';
  progress: number; // 0-100
  currentStep?: string;
  error?: string;
  outputPath?: string;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
}

export interface UploadResponse {
  success: boolean;
  source?: VideoSource;
  error?: string;
}

export interface ExportRequest {
  project: Project;
}

export interface ExportResponse {
  success: boolean;
  jobId?: string;
  error?: string;
}
