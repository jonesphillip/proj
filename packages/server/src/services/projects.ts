import { join } from 'path';
import type { Project, ProjectMetadata } from '@proj/shared';

const DATA_DIR = join(import.meta.dir, '../../../../data');
const PROJECTS_DIR = join(DATA_DIR, 'projects');
const INDEX_FILE = join(PROJECTS_DIR, 'index.json');

async function ensureProjectsDir(): Promise<void> {
  try {
    await Bun.write(join(PROJECTS_DIR, '.gitkeep'), '');
  } catch {
  }
}

async function loadIndex(): Promise<ProjectMetadata[]> {
  await ensureProjectsDir();
  const file = Bun.file(INDEX_FILE);
  if (await file.exists()) {
    const content = await file.text();
    return JSON.parse(content);
  }
  return [];
}

async function saveIndex(index: ProjectMetadata[]): Promise<void> {
  await ensureProjectsDir();
  await Bun.write(INDEX_FILE, JSON.stringify(index, null, 2));
}

function extractMetadata(project: Project): ProjectMetadata {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    thumbnailUrl: project.source.thumbnails?.[0] || null,
    duration: project.timeline.duration,
    sourceFilename: project.source.filename,
  };
}

export async function listProjects(): Promise<ProjectMetadata[]> {
  const index = await loadIndex();
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  await ensureProjectsDir();
  const file = Bun.file(join(PROJECTS_DIR, `${id}.json`));
  if (await file.exists()) {
    const content = await file.text();
    return JSON.parse(content);
  }
  return null;
}

export async function saveProject(project: Project): Promise<ProjectMetadata> {
  await ensureProjectsDir();

  project.updatedAt = Date.now();

  await Bun.write(
    join(PROJECTS_DIR, `${project.id}.json`),
    JSON.stringify(project, null, 2)
  );

  const index = await loadIndex();
  const metadata = extractMetadata(project);
  const existingIndex = index.findIndex(p => p.id === project.id);

  if (existingIndex >= 0) {
    index[existingIndex] = metadata;
  } else {
    index.push(metadata);
  }

  await saveIndex(index);

  return metadata;
}

export async function deleteProject(id: string): Promise<boolean> {
  await ensureProjectsDir();

  const file = Bun.file(join(PROJECTS_DIR, `${id}.json`));
  if (await file.exists()) {
    const fs = await import('fs/promises');
    await fs.unlink(join(PROJECTS_DIR, `${id}.json`));

    const index = await loadIndex();
    const newIndex = index.filter(p => p.id !== id);
    await saveIndex(newIndex);

    return true;
  }

  return false;
}
