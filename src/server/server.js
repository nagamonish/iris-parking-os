import http from 'node:http';
import path from 'node:path';
import db, {
  addFacility,
  createUser,
  getUserByEmail,
  getWorkspace,
  initializeDatabase,
  recordCameraEvent,
  recordCameraTestEvent,
  reassignDriver,
  runCameraScan,
  seedWorkspace
} from './db.js';
import {
  createSession,
  destroySession,
  getAuthenticatedUser,
  hashPassword,
  normalizeEmail,
  publicUser,
  verifyPassword
} from './auth.js';
import { clearSessionCookie, readJson, readMultipartForm, routeUrl, sendError, sendJson, serveStatic } from './http.js';
import { persistGroundTruthUpload, persistVisionUpload, spawnVisionDetector } from './vision.js';

const PORT = Number(process.env.PORT || 4180);
const publicDir = path.join(process.cwd(), 'public');

initializeDatabase();

function validateRegistration(body) {
  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const role = 'provider';
  const organizationName = String(body.organizationName || body.orgName || 'Crown City Parking Group').trim();
  const providerType = String(body.providerType || 'Commercial Parking Company').trim();

  if (name.length < 2) return { error: 'Enter your name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (organizationName.length < 2) return { error: 'Enter an organization or workspace name.' };

  return { name, email, password, role, organizationName, providerType };
}

async function register(req, res) {
  const body = await readJson(req);
  const payload = validateRegistration(body);
  if (payload.error) return sendError(res, 400, payload.error);
  if (getUserByEmail(payload.email)) return sendError(res, 409, 'An account already exists for this email.');

  const passwordHash = await hashPassword(payload.password);
  const user = createUser({
    name: payload.name,
    email: payload.email,
    passwordHash,
    role: payload.role,
    organizationName: payload.organizationName,
    providerType: payload.providerType
  });
  seedWorkspace(user.id, payload.organizationName, payload.providerType);

  const session = createSession(user.id);
  return sendJson(res, 201, { user: publicUser(user), workspace: getWorkspace(user.id) }, {
    'set-cookie': session.cookie
  });
}

async function login(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const user = getUserByEmail(email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return sendError(res, 401, 'Email or password is incorrect.');
  }

  const session = createSession(user.id);
  return sendJson(res, 200, { user: publicUser(user), workspace: getWorkspace(user.id) }, {
    'set-cookie': session.cookie
  });
}

function requireUser(req, res) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendError(res, 401, 'Authentication required.');
    return null;
  }
  return user;
}

function writeNdjson(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function parseDetectorLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return { type: 'log', message: line };
  }
}

async function analyzeVision(req, res, user) {
  if (user.role !== 'provider') return sendError(res, 403, 'Only operator accounts can run vision detection.');

  const { fields, files } = await readMultipartForm(req);
  const facilityId = String(fields.facilityId || '');
  const file = files.video;
  const groundTruthFile = files.groundTruth;
  const persistEvents = fields.persistEvents !== 'false';
  if (!facilityId) return sendError(res, 400, 'Choose a facility before running vision detection.');
  if (!file?.data?.length) return sendError(res, 400, 'Upload real parking-lot footage first.');

  const { videoPath, calibrationPath } = await persistVisionUpload({
    file,
    calibration: fields.calibration || '{}'
  });
  const groundTruthPath = await persistGroundTruthUpload(groundTruthFile);

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store'
  });

  writeNdjson(res, { type: 'started', message: 'Vision detector started.' });

  const child = spawnVisionDetector({
    videoPath,
    calibrationPath,
    model: fields.model || 'auto',
    confidence: Number(fields.confidence || 0.55),
    sampleRate: Number(fields.sampleRate || 4),
    warmupSeconds: Number(fields.warmupSeconds || 3.2),
    maxSpaceEventsPerSecond: Number(fields.maxSpaceEventsPerSecond || 2),
    laneCooldownSeconds: Number(fields.laneCooldownSeconds || 5),
    groundTruthPath
  });

  res.on('close', () => {
    if (!res.writableEnded && !child.killed) child.kill('SIGTERM');
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines.map((value) => value.trim()).filter(Boolean)) {
      const payload = parseDetectorLine(line);
      if (payload.type === 'event') {
        if (persistEvents) {
          recordCameraEvent(user.id, {
            facilityId,
            eventType: payload.eventType,
            confidence: payload.confidence,
            motionScore: payload.motionScore,
            delta: payload.delta,
            source: payload.detector === 'motion_fallback'
              ? 'motion fallback'
              : payload.detector === 'yolo_obb' || payload.detector === 'auto_obb_v8'
                ? 'YOLO OBB vision model'
                : 'vision model',
            spaceId: payload.spaceId,
            message: payload.message
          });
          writeNdjson(res, {
            ...payload,
            workspace: getWorkspace(user.id)
          });
        } else {
          writeNdjson(res, { ...payload, validationOnly: true });
        }
      } else {
        writeNdjson(res, payload);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString('utf8');
  });

  child.on('error', (error) => {
    writeNdjson(res, { type: 'error', message: error.message });
    res.end();
  });

  child.on('close', (code) => {
    if (stdoutBuffer.trim()) writeNdjson(res, parseDetectorLine(stdoutBuffer.trim()));
    if (code !== 0) {
      writeNdjson(res, {
        type: 'error',
        message: stderrBuffer.trim() || `Vision detector exited with code ${code}.`
      });
    }
    writeNdjson(res, { type: 'complete', code, workspace: getWorkspace(user.id) });
    res.end();
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/auth/register') return register(req, res);
  if (req.method === 'POST' && url.pathname === '/api/auth/login') return login(req, res);

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    destroySession(req);
    return sendJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET' && url.pathname === '/api/me') {
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/workspace') {
    return sendJson(res, 200, { workspace: getWorkspace(user.id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/vision/analyze') {
    await analyzeVision(req, res, user);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/facilities') {
    if (user.role !== 'provider') return sendError(res, 403, 'Only operator accounts can add facilities.');
    addFacility(user.id, await readJson(req));
    return sendJson(res, 201, { workspace: getWorkspace(user.id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/scan') {
    runCameraScan(user.id);
    return sendJson(res, 200, { workspace: getWorkspace(user.id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/camera-events') {
    if (user.role !== 'provider') return sendError(res, 403, 'Only operator accounts can record camera events.');
    recordCameraTestEvent(user.id, await readJson(req));
    return sendJson(res, 201, { workspace: getWorkspace(user.id) });
  }

  if (req.method === 'POST' && url.pathname === '/api/driver/reassign') {
    reassignDriver(user.id);
    return sendJson(res, 200, { workspace: getWorkspace(user.id) });
  }

  return sendError(res, 404, 'API route not found.');
}

const server = http.createServer(async (req, res) => {
  const url = routeUrl(req);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'Method not allowed.');
      return;
    }

    await serveStatic(req, res, publicDir);
  } catch (error) {
    const status = error.status || 500;
    const message = status >= 500 ? 'Something went wrong.' : error.message;
    if (status >= 500) console.error(error);
    sendError(res, status, message);
  }
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`IRIS Parking OS running on http://localhost:${PORT}`);
});
