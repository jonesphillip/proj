---
name: proj-video-editing
description: Create and edit video projects programmatically using proj's JSON format and HTTP API. Use this skill when the user wants to create, modify, or export video projects via the API or by editing project JSON files.
---

# Video Editing with proj

proj stores projects as JSON files. You can create and edit videos programmatically by modifying project JSON and calling a few HTTP endpoints.

## Setup

The server runs at `http://localhost:3001`. Start it with `bun run dev` from the project root.

## Before Editing: Understand the Video

**Always probe and screenshot videos before making any edits.** This lets you make informed decisions about trimming, zoom targets, overlay placement/sizing, and caption content.

### Step 1: Probe the source files

Before uploading, probe local files to understand what you're working with:

```bash
# Get duration, resolution, fps for any video file
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4

# Quick summary
ffprobe -v quiet -show_entries format=duration:stream=width,height,r_frame_rate -of csv=p=0 input.mp4
```

For existing projects, get the source info from the API:

```bash
curl -s http://localhost:3001/api/projects/{id} | jq '{path: .source.path, duration: .source.duration, width: .source.width, height: .source.height}'
```

Uploaded files live at `data/uploads/` on disk (the `path` field is server-relative, e.g., `/uploads/abc123.mp4`).

### Step 2: Extract frames with ffmpeg

Scale the number of screenshots to the video length:

| Video duration | Interval | Approx frames |
|---------------|----------|---------------|
| < 10s | Every 1s | 5–10 |
| 10–60s | Every 3s | 5–20 |
| 1–5 min | Every 5–10s | 12–30 |
| > 5 min | Every 15–30s | 15–30 |

```bash
mkdir -p /tmp/proj-frames

# Extract frames — works on local files or uploaded files
ffmpeg -y -i input.mp4 -vf "fps=1/3,scale=960:-1" -q:v 2 /tmp/proj-frames/frame_%03d.jpg

# For a long video, extract only a specific range (e.g., last 2 minutes of a 7 min video)
ffmpeg -y -i input.mp4 -ss 300 -vf "fps=1/5,scale=960:-1" -q:v 2 /tmp/proj-frames/frame_%03d.jpg
```

Use `-vf "fps=1/N"` where N is the interval in seconds. The `scale=960:-1` keeps frames small enough to review quickly while preserving enough detail. For portrait videos, use `scale=-1:960` instead.

If there are multiple source files (main video, overlay, audio), probe and screenshot all of them to understand how they relate.

### Step 3: Review the frames

Read the extracted frames to understand the video content. Look for:

- **Scene changes** — where cuts or transitions happen (useful for trimming/splitting)
- **Key content areas** — where the action or focus is (useful for zoom `centerX`/`centerY`)
- **Screen regions** — app demos, UI elements, faces (useful for overlay placement and sizing)
- **Text or speech moments** — what's being shown or discussed (useful for caption text and timing)
- **Empty/dead space** — sections to cut or speed up

### Step 4: Plan edits based on what you see

Now you can make informed decisions:

- **Zoom effects**: Place `centerX`/`centerY` on the actual region of interest you saw in the frames
- **Overlay position/size**: Size and position relative to what's actually on screen — avoid covering key content
- **Captions**: Write text that matches what's happening at each timestamp
- **Trimming**: Cut segments where you identified dead space or irrelevant content
- **Speed**: Speed up slow sections you identified in the review

### Cleanup

```bash
rm -rf /tmp/proj-frames
```

## Workflow

### Creating a project from scratch

1. **Upload a video** — `POST /api/upload` with multipart form data (field: `video`). Returns a `VideoSource` object with `id`, `path`, `duration`, `width`, `height`, `fps`, `codec`, `bitrate`.

2. **Build the project JSON** — Construct a full project object with a unique `id`, the `source` from step 1, a timeline with a video track, and export settings. The minimum viable project needs one video track with one segment spanning the full source duration:

```jsonc
{
  "id": "my-project-id",
  "name": "my-video",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "source": { /* VideoSource from upload response */ },
  "timeline": {
    "duration": 60.0,  // match source duration
    "pixelsPerSecond": 10,
    "scrollOffset": 0,
    "playheadPosition": 0,
    "isPlaying": false,
    "tracks": [{
      "id": "video-track",
      "type": "video",
      "name": "Video",
      "segments": [{
        "id": "seg-1",
        "trackId": "video-track",
        "type": "video",
        "startTime": 0,
        "duration": 60.0,       // same as source duration
        "sourceStart": 0,
        "sourceEnd": 60.0,      // same as source duration
        "effects": {}
      }]
    }]
  },
  "exportSettings": {
    "preset": "twitter-1080p",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "bitrate": 8000000,
    "codec": "h264",
    "quality": "high",
    "aspectRatio": "16:9"
  },
  "overlaySources": [],
  "audioSources": []
}
```

3. **Save** — `PUT /api/projects/{id}` with body `{ "project": { ... } }`. This creates the project file and adds it to the index.

4. **Export** — `POST /api/export` with body `{ "project": { ... } }`. Returns `{ jobId }`. Poll `GET /api/export/{jobId}` until `status` is `"complete"`, then download from the `outputPath`.

### Editing an existing project

1. **Get the project** — `GET /api/projects/{id}` returns the full project JSON
2. **Edit the JSON** — Modify the timeline, add segments, change export settings
3. **Save** — `PUT /api/projects/{id}` with body `{ "project": { ... } }`
4. **Export** — same as above

### Adding overlays

Upload with `POST /api/upload/overlay` (multipart, field: `video`). Returns an `OverlaySource` with id, path, dimensions, duration. Add it to the project's `overlaySources[]` array, then create an overlay segment on the overlay track.

### Adding audio

Upload with `POST /api/upload/audio` (multipart, field: `audio`). Returns an `AudioSource` with id, path, duration. Add it to `audioSources[]`, then create an audio segment on the audio track.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/{id}` | Get full project JSON |
| `PUT` | `/api/projects/{id}` | Save project (`{ "project": { ... } }`) |
| `POST` | `/api/upload` | Upload source video (multipart, field: `video`) |
| `POST` | `/api/upload/overlay` | Upload overlay video (multipart, field: `video`) |
| `POST` | `/api/upload/audio` | Upload audio file (multipart, field: `audio`) |
| `POST` | `/api/export` | Start export (`{ "project": { ... } }`), returns `{ jobId }` |
| `GET` | `/api/export/{jobId}` | Poll export progress |
| `GET` | `/exports/{filename}` | Download exported video |

## Project JSON Structure

Every project has a `source` (the uploaded video), a `timeline` with tracks containing segments, `exportSettings`, and optional `overlaySources`/`audioSources` arrays.

```jsonc
{
  "id": "abc123",
  "name": "my-video",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "source": {
    "id": "src-id",
    "filename": "input.mp4",
    "path": "/uploads/src-id.mp4",
    "duration": 60.0,
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "codec": "h264",
    "bitrate": 8000000
  },
  "timeline": {
    "duration": 60.0,
    "tracks": [
      // See track/segment types below
    ]
  },
  "exportSettings": {
    "preset": "twitter-1080p",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "bitrate": 8000000,
    "codec": "h264",
    "quality": "high",
    "aspectRatio": "16:9"
  },
  "overlaySources": [],
  "audioSources": []
}
```

### Export settings

| Field | Values | Description |
|-------|--------|-------------|
| `preset` | `"source-high"`, `"twitter-1080p"`, `"twitter-720p"`, `"twitter-480p"` | Resolution preset |
| `quality` | `"high"` (CRF 12), `"medium"` (CRF 18), `"low"` (CRF 24) | Encoding quality |
| `aspectRatio` | `"source"`, `"16:9"`, `"9:16"`, `"1:1"`, `"4:5"` | Output aspect ratio |
| `codec` | `"h264"`, `"h265"` | Video codec |

## Tracks and Segments

The timeline has 5 track types. Each track has a `segments[]` array. Every segment has these common fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique segment ID |
| `trackId` | string | ID of the parent track |
| `type` | string | `"video"`, `"caption"`, `"zoom"`, `"overlay"`, or `"audio"` |
| `startTime` | number | Position on the timeline (seconds) |
| `duration` | number | Duration on the timeline (seconds) |
| `effects` | object | `{}` for most types. Video segments can have `speed`, `audioMuted`, `audioVolume` |

Track IDs are fixed: `video-track`, `caption-track`, `effect-track`, `overlay-track`, `audio-track`.

### Video segments

Reference ranges of the source video. The timeline is built from these — split, reorder, or remove segments to edit the video.

```jsonc
{
  "id": "seg-1",
  "trackId": "video-track",
  "type": "video",
  "startTime": 0,
  "duration": 15.0,
  "sourceStart": 5.0,       // start time in source video (seconds)
  "sourceEnd": 20.0,        // end time in source video (seconds)
  "effects": {
    "speed": { "rate": 1.5 },  // 0.25–10, playback speed
    "audioMuted": false,        // mute this segment's audio
    "audioVolume": 0.8          // 0–1, volume level
  }
}
```

When using speed, the timeline `duration` should be `(sourceEnd - sourceStart) / rate`.

### Caption segments

Text overlays rendered onto the video with styling and positioning.

```jsonc
{
  "id": "cap-1",
  "trackId": "caption-track",
  "type": "caption",
  "startTime": 2.0,
  "duration": 4.0,
  "text": "Hello world",
  "style": {
    "fontSize": 96,
    "fontFamily": "Arial",
    "fontColor": "#ffffff",
    "backgroundColor": "#666666",
    "backgroundOpacity": 0.9,       // 0–1
    "position": {
      "vertical": "bottom",         // "top" | "center" | "bottom"
      "horizontal": "center",       // "left" | "center" | "right"
      "offsetX": 0,                 // pixel offset from position
      "offsetY": 50
    },
    "padding": 40
  },
  "effects": {}
}
```

### Zoom effect segments

Animated zoom-in/out on a region of the video with smoothstep easing.

```jsonc
{
  "id": "zoom-1",
  "trackId": "effect-track",
  "type": "zoom",
  "startTime": 5.0,
  "duration": 3.0,
  "zoom": 2.0,              // 1.0 = no zoom, 2.0 = 2x
  "centerX": 0.5,           // 0–1 normalized, horizontal center of zoom
  "centerY": 0.3,           // 0–1 normalized, vertical center of zoom
  "zoomInDuration": 0.5,    // seconds to animate in (0 = instant)
  "zoomOutDuration": 0.5,   // seconds to animate out (0 = instant)
  "effects": {}
}
```

### Overlay segments

Layer another video on top. Requires a matching entry in `overlaySources[]`. Position/size are normalized 0–1 relative to the main video.

```jsonc
// Add to overlaySources[] (returned by POST /api/upload/overlay):
{
  "id": "ovl-src-1",
  "filename": "screen-recording.mp4",
  "path": "/uploads/ovl-src-1.mp4",
  "duration": 10.0,
  "width": 1280,
  "height": 720,
  "fps": 30
}
```

```jsonc
// Add to overlay track segments[]:
{
  "id": "ovl-1",
  "trackId": "overlay-track",
  "type": "overlay",
  "startTime": 0,
  "duration": 10.0,
  "overlaySourceId": "ovl-src-1",
  "sourceStart": 0,
  "sourceEnd": 10.0,
  "position": {
    "x": 0.6,          // 0–1, left edge position
    "y": 0.6,          // 0–1, top edge position
    "width": 0.35,     // 0–1, fraction of main video width
    "height": 0.35     // 0–1, fraction of main video height
  },
  "opacity": 1.0,       // 0–1
  "borderRadius": 12,   // pixels, 0 for square corners
  "deviceFrameId": null, // "iphone-17-pro" to wrap in device frame, or null
  "effects": {}
}
```

### Audio segments

Background music or additional audio. Requires a matching entry in `audioSources[]`.

```jsonc
// Add to audioSources[] (returned by POST /api/upload/audio):
{
  "id": "aud-src-1",
  "filename": "background-music.mp3",
  "path": "/uploads/aud-src-1.mp3",
  "duration": 120.0
}
```

```jsonc
// Add to audio track segments[]:
{
  "id": "aud-1",
  "trackId": "audio-track",
  "type": "audio",
  "startTime": 0,
  "duration": 30.0,
  "audioSourceId": "aud-src-1",
  "sourceStart": 0,
  "sourceEnd": 30.0,
  "volume": 0.5,          // 0–1
  "fadeInDuration": 2.0,   // seconds, 0 for no fade
  "fadeOutDuration": 3.0,  // seconds, 0 for no fade
  "muted": false,
  "effects": {}
}
```

## Common Edits

**Trim a video** — Change `sourceStart`/`sourceEnd` on video segments. Set `duration` to `sourceEnd - sourceStart`.

**Speed up a clip** — Set `effects.speed.rate` (e.g., `2.0` for 2x). Set `duration` to `(sourceEnd - sourceStart) / rate`.

**Add a caption** — Add a segment to the caption track with `text`, `style`, `startTime`, and `duration`.

**Mute a section** — Set `effects.audioMuted: true` on the video segment.

**Add background music** — Upload audio, add to `audioSources[]`, create audio segment on audio track.

**Picture-in-picture** — Upload overlay video, add to `overlaySources[]`, create overlay segment with desired `position`.

**Change export format** — Set `exportSettings.aspectRatio` (e.g., `"9:16"` for vertical) and `preset` for resolution.

## Tips

**Write JSON to a file before curling.** Project JSON is too large to pass inline with `curl -d '{...}'`. Write to a temp file and use `-d @file`:

```bash
# Write project JSON to temp file, then save/export
cat > /tmp/proj-payload.json << 'EOF'
{ "project": { ... } }
EOF

curl -s -X PUT http://localhost:3001/api/projects/{id} -H "Content-Type: application/json" -d @/tmp/proj-payload.json
curl -s -X POST http://localhost:3001/api/export -H "Content-Type: application/json" -d @/tmp/proj-payload.json
```

**Verify exports by extracting frames.** After an export completes, spot-check the result:

```bash
mkdir -p /tmp/proj-frames/export
ffmpeg -y -i data/exports/{filename}.mp4 -vf "fps=1/20,scale=960:-1" -q:v 2 /tmp/proj-frames/export/frame_%03d.jpg
```

Review a few frames to confirm overlays are positioned correctly, captions are visible, and zoom targets are accurate.

**Clean up temp files** when done:

```bash
rm -rf /tmp/proj-frames /tmp/proj-payload.json
```

## Type Definitions

Full TypeScript types are in `packages/shared/src/types/project.ts`.
