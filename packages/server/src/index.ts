import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type { Project, ExportProgress, UploadResponse, ExportRequest } from '@proj/shared';
import { processUpload, processOverlayUpload, processAudioUpload, extractFrame, startExport, getExportJob, resolveMediaPath, generateThumbnails, getProcessingStatus } from './services/ffmpeg';
import { listProjects, getProject, saveProject, deleteProject } from './services/projects';

const app = new Hono();
const DATA_DIR = join(import.meta.dir, '../../../data');

// Ensure data directories exist on startup
const { mkdir } = await import('fs/promises');
for (const dir of ['uploads', 'exports', 'thumbnails', 'projects', 'temp']) {
  await mkdir(join(DATA_DIR, dir), { recursive: true });
}

app.use('/*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

async function serveFile(filepath: string, contentType: string) {
  const file = Bun.file(filepath);
  if (await file.exists()) {
    return new Response(file.stream(), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(file.size),
      },
    });
  }
  return null;
}

async function serveVideo(filepath: string, rangeHeader: string | undefined) {
  const file = Bun.file(filepath);
  if (!(await file.exists())) {
    return null;
  }

  const fileSize = file.size;

  // Handle Range request for video seeking
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  // No Range header - return full file with Accept-Ranges
  return new Response(file.stream(), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
    },
  });
}

app.get('/uploads/:filename', async (c) => {
  const filename = c.req.param('filename');
  const filepath = join(DATA_DIR, 'uploads', filename);
  const rangeHeader = c.req.header('Range');
  const response = await serveVideo(filepath, rangeHeader);
  return response || c.notFound();
});

app.get('/thumbnails/:filename', async (c) => {
  const filename = c.req.param('filename');
  const filepath = join(DATA_DIR, 'thumbnails', filename);
  const response = await serveFile(filepath, 'image/jpeg');
  return response || c.notFound();
});

app.get('/exports/:filename', async (c) => {
  const filename = c.req.param('filename');
  const filepath = join(DATA_DIR, 'exports', filename);
  const rangeHeader = c.req.header('Range');
  const response = await serveVideo(filepath, rangeHeader);
  return response || c.notFound();
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Upload video
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('video') as File | null;

    if (!file) {
      return c.json<UploadResponse>({ success: false, error: 'No file provided' }, 400);
    }

    const source = await processUpload(file);
    return c.json<UploadResponse>({ success: true, source });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json<UploadResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }, 500);
  }
});

// Poll background processing status (proxy, waveform, thumbnails)
app.get('/api/source/:id/status', (c) => {
  const id = c.req.param('id');
  const status = getProcessingStatus(id);
  if (!status) {
    return c.json({ status: 'unknown' });
  }
  return c.json(status);
});

// Upload overlay video
app.post('/api/upload/overlay', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('video') as File | null;

    if (!file) {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }

    const source = await processOverlayUpload(file);
    return c.json({ success: true, source });
  } catch (error) {
    console.error('Overlay upload error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Overlay upload failed',
    }, 500);
  }
});

// Upload audio file
app.post('/api/upload/audio', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('audio') as File | null;

    if (!file) {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }

    const source = await processAudioUpload(file);
    return c.json({ success: true, source });
  } catch (error) {
    console.error('Audio upload error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Audio upload failed',
    }, 500);
  }
});

// Extract single frame for scrubbing
app.get('/api/frame', async (c) => {
  const path = c.req.query('path');
  const time = parseFloat(c.req.query('time') || '0');

  if (!path) {
    return c.json({ error: 'No path provided' }, 400);
  }

  try {
    const framePath = await extractFrame(path, time);
    return c.json({ path: framePath });
  } catch (error) {
    console.error('Frame extraction error:', error);
    return c.json({ error: 'Frame extraction failed' }, 500);
  }
});

// Project API endpoints
app.get('/api/projects', async (c) => {
  try {
    const projects = await listProjects();
    return c.json({ success: true, projects });
  } catch (error) {
    console.error('Failed to list projects:', error);
    return c.json({ success: false, error: 'Failed to list projects' }, 500);
  }
});

app.get('/api/projects/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const project = await getProject(id);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }
    return c.json({ success: true, project });
  } catch (error) {
    console.error('Failed to get project:', error);
    return c.json({ success: false, error: 'Failed to get project' }, 500);
  }
});

app.put('/api/projects/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ project: Project }>();
    const { project } = body;

    if (project.id !== id) {
      return c.json({ success: false, error: 'Project ID mismatch' }, 400);
    }

    const metadata = await saveProject(project);
    return c.json({ success: true, metadata });
  } catch (error) {
    console.error('Failed to save project:', error);
    return c.json({ success: false, error: 'Failed to save project' }, 500);
  }
});

app.delete('/api/projects/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const deleted = await deleteProject(id);
    if (!deleted) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to delete project:', error);
    return c.json({ success: false, error: 'Failed to delete project' }, 500);
  }
});

// Regenerate all project thumbnails at current quality
app.post('/api/projects/regenerate-thumbnails', async (c) => {
  try {
    const projects = await listProjects();
    let updated = 0;

    for (const meta of projects) {
      const project = await getProject(meta.id);
      if (!project?.source?.path) continue;

      const filePath = resolveMediaPath(project.source.path);
      const thumbnails = await generateThumbnails(filePath, project.source.duration);
      project.source.thumbnails = thumbnails;
      await saveProject(project);
      updated++;
    }

    return c.json({ success: true, updated });
  } catch (error) {
    console.error('Thumbnail regeneration error:', error);
    return c.json({ success: false, error: 'Failed to regenerate thumbnails' }, 500);
  }
});

// Get export job status
app.get('/api/export/:jobId', (c) => {
  const jobId = c.req.param('jobId');
  const job = getExportJob(jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return c.json({
    status: job.status,
    progress: job.progress,
    outputPath: job.outputPath,
    error: job.error,
    fileSize: job.fileSize,
  });
});

// WebSocket connections for export progress
const exportClients = new Map<string, Set<WebSocket>>();

function broadcastProgress(jobId: string, progress: ExportProgress) {
  const clients = exportClients.get(jobId);
  if (clients) {
    const message = JSON.stringify(progress);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}

// Start export
app.post('/api/export', async (c) => {
  try {
    const body = await c.req.json<ExportRequest>();
    const { project } = body;

    // Generate jobId before starting export so we can use it in the callback
    const jobId = nanoid();

    // Start export in background (don't await)
    startExport(project, jobId, (progress) => {
      broadcastProgress(jobId, progress);
    });

    return c.json({ success: true, jobId });
  } catch (error) {
    console.error('Export error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    }, 500);
  }
});

const port = parseInt(process.env.PORT || '3001', 10);

// Start server with WebSocket support
const server = Bun.serve({
  port,
  maxRequestBodySize: 1024 * 1024 * 1024, // 1GB
  fetch: app.fetch,
  websocket: {
    open(ws) {
      const wsData = ws.data as { jobId?: string } | undefined;
      const jobId = wsData?.jobId;
      if (jobId) {
        if (!exportClients.has(jobId)) {
          exportClients.set(jobId, new Set());
        }
        exportClients.get(jobId)!.add(ws as unknown as WebSocket);
      }
    },
    message() {},
    close(ws) {
      const wsData = ws.data as { jobId?: string } | undefined;
      const jobId = wsData?.jobId;
      if (jobId) {
        exportClients.get(jobId)?.delete(ws as unknown as WebSocket);
      }
    },
  },
});

console.log(`Server running at http://localhost:${port}`);
