import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = path.join(process.cwd(), 'data');
const uploadDir = path.join(dataDir, 'uploads');
const calibrationDir = path.join(dataDir, 'calibrations');
const groundTruthDir = path.join(dataDir, 'ground-truth');
const detectorScript = path.join(process.cwd(), 'vision', 'parking_detector.py');
const defaultVisionModel = 'auto';

function safeExt(filename, contentType) {
  const ext = path.extname(filename || '').toLowerCase();
  if (['.mp4', '.mov', '.webm', '.m4v', '.avi'].includes(ext)) return ext;
  if (contentType === 'video/webm') return '.webm';
  if (contentType === 'video/quicktime') return '.mov';
  return '.mp4';
}

function safeTruthExt(filename, contentType) {
  const ext = path.extname(filename || '').toLowerCase();
  if (['.json', '.csv'].includes(ext)) return ext;
  if (contentType === 'text/csv') return '.csv';
  return '.json';
}

function pythonCandidates() {
  return [
    process.env.IRIS_PYTHON,
    path.join(process.cwd(), '.venv', 'bin', 'python'),
    'python3.11',
    'python3'
  ].filter(Boolean);
}

function detectorArgs({
  videoPath,
  calibrationPath,
  model,
  confidence,
  sampleRate,
  groundTruthPath,
  warmupSeconds,
  maxSpaceEventsPerSecond,
  laneCooldownSeconds
}) {
  const args = [
    detectorScript,
    '--video', videoPath,
    '--calibration', calibrationPath,
    '--model', model || defaultVisionModel,
    '--confidence', String(confidence || 0.55),
    '--sample-rate', String(sampleRate || 4),
    '--warmup-seconds', String(warmupSeconds || 3.2),
    '--max-space-events-per-second', String(maxSpaceEventsPerSecond || 2),
    '--lane-cooldown-seconds', String(laneCooldownSeconds || 5),
    '--emit-progress'
  ];
  if (groundTruthPath) args.push('--ground-truth', groundTruthPath);
  return args;
}

export async function persistVisionUpload({ file, calibration }) {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(calibrationDir, { recursive: true });

  const id = crypto.randomUUID();
  const videoPath = path.join(uploadDir, `${id}${safeExt(file.filename, file.contentType)}`);
  const calibrationPath = path.join(calibrationDir, `${id}.json`);
  await writeFile(videoPath, file.data);
  await writeFile(calibrationPath, calibration || '{}');

  return { videoPath, calibrationPath };
}

export async function persistGroundTruthUpload(file) {
  if (!file?.data?.length) return null;
  await mkdir(groundTruthDir, { recursive: true });
  const id = crypto.randomUUID();
  const groundTruthPath = path.join(groundTruthDir, `${id}${safeTruthExt(file.filename, file.contentType)}`);
  await writeFile(groundTruthPath, file.data);
  return groundTruthPath;
}

export function spawnVisionDetector(options) {
  const candidates = pythonCandidates();
  const args = detectorArgs(options);
  let child = null;
  let lastError = null;

  for (const command of candidates) {
    try {
      child = spawn(command, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          YOLO_CONFIG_DIR: path.join(dataDir, 'yolo-config')
        }
      });
      child.once('error', (error) => {
        lastError = error;
      });
      return child;
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(`Unable to start Python vision detector: ${lastError?.message || 'no Python runtime found'}`);
  error.status = 500;
  throw error;
}
