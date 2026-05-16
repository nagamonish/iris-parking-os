import { api } from './api.js';
import { escapeHtml, formatNumber } from './components.js';
import { renderAuth, renderAuthPage, STORY_SCENE_COUNT } from './views/auth.js';
import { defaultVisionCalibration, renderShell } from './views/dashboard.js';

const app = document.getElementById('app');
const SCENE_SCROLL_THRESHOLD = 225;
const SCENE_TRANSITION_LOCK_MS = 2250;
const SCENE_WHEEL_IDLE_RESET_MS = 760;
const SCENE_WHEEL_DELTA_LIMIT = 28;
const TOUCH_SCENE_THRESHOLD = 146;
const STORY_SCENE_KEYS = ['intro', 'engine', 'location', 'nearby', 'route', 'reroute', 'operator', 'close'];
const THEME_STORAGE_KEY = 'iris-theme';
const VIDEO_FILE_PATTERN = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const TRUTH_FILE_PATTERN = /\.(json|csv)$/i;
const ROUTE_PATHS = {
  p7: 'M 50 94 C 50 84 50 76 50 68 C 50 61 56 57 63 57 L 63 50',
  p3: 'M 50 94 C 50 82 50 75 50 68 C 50 61 56 57 63 57 L 63 17'
};

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme() {
  const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return theme === 'dark' || theme === 'light' ? theme : systemTheme();
}

const state = {
  loading: true,
  user: null,
  workspace: null,
  route: window.location.pathname,
  view: 'overview',
  authMode: 'register',
  theme: storedTheme(),
  sceneIndex: 0,
  error: '',
  notice: ''
};

let wheelDelta = 0;
let sceneLockUntil = 0;
let sceneEffectTimers = [];
let lastWheelAt = 0;
let touchStartY = null;
let touchStartX = null;
let touchStartTarget = null;
const videoTest = {
  timer: null,
  url: '',
  lastFrame: null,
  lastEventAt: 0,
  eventCount: 0,
  canvas: null,
  pending: false
};
const visionRun = {
  controller: null,
  active: false,
  events: 0,
  file: null,
  truthFile: null,
  facilityId: ''
};
const calibrationTool = {
  videoUrl: '',
  frameCanvas: null,
  frameWidth: 1280,
  frameHeight: 720,
  zones: [],
  draftPoints: [],
  loadedFacilityId: '',
  nextSpaceNumber: 1,
  nextLaneNumber: 1,
  pointer: null
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function setTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
  setState({ theme: nextTheme });
}

applyTheme(state.theme);

function setState(patch) {
  Object.assign(state, patch);
  if (patch.theme) applyTheme(state.theme);
  render();
}

function render() {
  if (state.loading) {
    app.innerHTML = '<main class="landing"><section class="landing-grid"><div class="hero-panel"><h1>IRIS<span>.</span></h1><p class="hero-copy">Loading workspace...</p></div></section></main>';
    return;
  }

  app.innerHTML = state.user && state.workspace
    ? renderShell(state)
    : isAuthRoute()
      ? renderAuthPage(state)
      : renderAuth(state);

  queueMicrotask(scheduleStorySceneEffects);
  queueMicrotask(hydrateDetectionView);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function isSignedIn() {
  return Boolean(state.user && state.workspace);
}

function isStoryMode() {
  return !state.loading && !isSignedIn() && !isAuthRoute();
}

function isAuthRoute() {
  return state.route === '/auth';
}

function navigate(route, patch = {}) {
  const nextRoute = route || '/';
  if (window.location.pathname !== nextRoute) {
    window.history.pushState({}, '', nextRoute);
  }
  setState({ route: nextRoute, error: '', notice: '', ...patch });
}

function closestElement(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

function clampSceneIndex(index) {
  return Math.max(0, Math.min(STORY_SCENE_COUNT - 1, index));
}

function setSceneIndex(index) {
  const sceneIndex = clampSceneIndex(index);
  if (sceneIndex === state.sceneIndex) return false;
  setState({ sceneIndex });
  return true;
}

function stepScene(direction) {
  const now = Date.now();
  if (now < sceneLockUntil) return false;

  const changed = setSceneIndex(state.sceneIndex + direction);
  if (changed) {
    wheelDelta = 0;
    lastWheelAt = 0;
    sceneLockUntil = now + SCENE_TRANSITION_LOCK_MS;
  }
  return changed;
}

function clearSceneEffects() {
  sceneEffectTimers.forEach((timer) => window.clearTimeout(timer));
  sceneEffectTimers = [];
}

function after(delay, callback) {
  const timer = window.setTimeout(callback, delay);
  sceneEffectTimers.push(timer);
}

function activeStoryScene() {
  return app.querySelector('.story-scene.active');
}

function sceneElement(selector) {
  return activeStoryScene()?.querySelector(selector) || null;
}

function addOn(selector, delay = 0) {
  after(delay, () => sceneElement(selector)?.classList.add('on'));
}

function setSceneText(selector, html, delay = 0) {
  after(delay, () => {
    const element = sceneElement(selector);
    if (element) element.innerHTML = html;
  });
}

function setRoutePath(prefix, target, delay = 0) {
  after(delay, () => {
    const path = ROUTE_PATHS[target];
    const scene = activeStoryScene();
    const main = scene?.querySelector(`#routeMain${prefix}`);
    const halo = scene?.querySelector(`#routeHalo${prefix}`);
    const flow = scene?.querySelector(`#routeFlow${prefix}`);
    main?.classList.remove('on');
    flow?.classList.remove('on');
    [main, halo, flow].forEach((element) => {
      if (element) element.setAttribute('d', path);
    });
    [main, flow].forEach((element) => {
      if (element) element.classList.toggle('green', target === 'p3');
    });
    if (main) window.requestAnimationFrame(() => main.classList.add('on'));
    if (flow) window.requestAnimationFrame(() => flow.classList.add('on'));
  });
}

function moveDriver(prefix, left, top, delay = 0) {
  after(delay, () => {
    const driver = sceneElement(`#driver${prefix}`);
    if (!driver) return;
    driver.style.left = left;
    driver.style.top = top;
  });
}

function scheduleStorySceneEffects() {
  clearSceneEffects();
  if (!isStoryMode()) return;

  const sceneKey = STORY_SCENE_KEYS[clampSceneIndex(state.sceneIndex)];

  after(24, () => {
    if (sceneKey === 'engine') {
      addOn('#engineEyebrow', 120);
      addOn('#engineName', 340);
      addOn('#engineExpand', 620);
      addOn('#engineDesc', 900);
      ['#p1', '#p2', '#p3'].forEach((selector, index) => addOn(selector, 1220 + index * 210));
    }

    if (sceneKey === 'location') {
      addOn('#typedAddr', 180);
      addOn('#locCard', 1320);
      addOn('#occFill', 1720);
    }

    if (sceneKey === 'nearby') {
      ['#nearby1', '#nearby2', '#nearby3', '#nearby4'].forEach((selector, index) => addOn(selector, 220 + index * 230));
    }

    if (sceneKey === 'route') {
      addOn('#hud1', 180);
      addOn('#spotCard1', 420);
      addOn('#routeMain1', 720);
      addOn('#routeFlow1', 920);
      addOn('#driver1', 960);
      moveDriver('1', '49%', '88%', 980);
      moveDriver('1', '50%', '68%', 1480);
      moveDriver('1', '63%', '57%', 2050);
      moveDriver('1', '63%', '50%', 2620);
    }

    if (sceneKey === 'reroute') {
      addOn('#hud2', 180);
      addOn('#spotCard2', 420);
      addOn('#routeMain2', 700);
      addOn('#routeFlow2', 880);
      addOn('#driver2', 920);
      moveDriver('2', '49%', '88%', 940);
      moveDriver('2', '50%', '68%', 1460);
      moveDriver('2', '63%', '57%', 2020);
      addOn('#rerouteBanner', 2400);
      after(2440, () => {
        sceneElement('#sp7b')?.classList.remove('target');
        sceneElement('#sp7b')?.classList.add('taken');
        sceneElement('#sp3b')?.classList.remove('open');
        sceneElement('#sp3b')?.classList.add('target-green');
      });
      setRoutePath('2', 'p3', 2500);
      setSceneText('#hud2Text', 'Head to <span>P3</span>', 2500);
      setSceneText('#spotLabel2', 'Spot P3', 2500);
      setSceneText('#spotDist2', '90 ft', 2500);
      moveDriver('2', '50%', '68%', 2760);
      moveDriver('2', '63%', '57%', 3360);
      moveDriver('2', '63%', '17%', 3960);
    }

    if (sceneKey === 'operator') {
      app.querySelectorAll('.story-scene.active .kpi').forEach((card, index) => {
        after(180 + index * 170, () => card.classList.add('on'));
      });
      app.querySelectorAll('.story-scene.active .bars-chart span').forEach((bar, index) => {
        after(760 + index * 70, () => bar.classList.add('on'));
      });
      addOn('.demo-launch', 1760);
    }

    if (sceneKey === 'close') {
      addOn('.close-eyebrow', 160);
      addOn('.close-title', 380);
      addOn('.close-sub', 760);
      addOn('.close-action', 1120);
    }
  });
}

function isTypingTarget(target) {
  return Boolean(closestElement(target, 'input, textarea, select, [contenteditable="true"]'));
}

function canScrollWithinActiveScene(target, direction) {
  const scene = closestElement(target, '.story-scene.active');
  if (!scene || scene.scrollHeight <= scene.clientHeight + 2) return false;
  const overflowY = window.getComputedStyle(scene).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
  if (direction > 0) return scene.scrollTop + scene.clientHeight < scene.scrollHeight - 2;
  return scene.scrollTop > 2;
}

function workspaceFacilities(workspace = state.workspace) {
  return workspace?.properties?.flatMap((property) => property.facilities) || [];
}

function cameraMapRows(workspace) {
  return workspaceFacilities(workspace).map((facility) => `
    <tr>
      <td><strong>${escapeHtml(facility.name)}</strong><br><span>${escapeHtml(facility.type)}</span></td>
      <td>${formatNumber(facility.open_spaces)} open</td>
      <td>${facility.cameras_online}/${facility.cameras_total}</td>
      <td>${facility.confidence}%</td>
    </tr>
  `).join('');
}

function eventList(workspace) {
  if (!workspace?.events?.length) return '<div class="empty">Run a camera scan to create persisted events.</div>';
  return `
    <div class="event-list">
      ${workspace.events.map((event) => `
        <div class="event-row live-event-row">
          <strong>${escapeHtml(event.event_type.replaceAll('_', ' '))}</strong>
          <span>${escapeHtml(event.message)} · ${event.confidence}% · ${new Date(event.created_at).toLocaleString()}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function refreshDetectionSurface(workspace) {
  const mapBody = app.querySelector('[data-camera-map-body]');
  const eventLog = app.querySelector('[data-event-log]');
  if (mapBody) mapBody.innerHTML = cameraMapRows(workspace);
  if (eventLog) eventLog.innerHTML = eventList(workspace);
}

function calibrationForFacility(facilityId) {
  return state.workspace?.calibrations?.[facilityId]?.calibration || null;
}

function selectedVisionFacilityId() {
  const select = app.querySelector('[data-vision-facility]');
  return select?.value || visionRun.facilityId || workspaceFacilities()[0]?.id || '';
}

function setCalibrationStatus(message, tone = '') {
  const status = app.querySelector('[data-calibration-status]');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function roundCoord(value) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function cloneCalibration(calibration) {
  return JSON.parse(JSON.stringify(calibration || { spaces: [], lanes: [] }));
}

function zonesFromCalibration(calibration) {
  const payload = cloneCalibration(calibration);
  return [
    ...(payload.spaces || []).map((zone) => ({ type: 'space', id: String(zone.id || ''), points: zone.points || [] })),
    ...(payload.lanes || []).map((zone) => ({ type: 'lane', id: String(zone.id || ''), points: zone.points || [] }))
  ].filter((zone) => zone.id && zone.points.length >= 3);
}

function calibrationFromZones() {
  const spaces = calibrationTool.zones
    .filter((zone) => zone.type === 'space')
    .map((zone) => ({ id: zone.id, points: zone.points.map(([x, y]) => [roundCoord(x), roundCoord(y)]) }));
  const lanes = calibrationTool.zones
    .filter((zone) => zone.type === 'lane')
    .map((zone) => ({ id: zone.id, points: zone.points.map(([x, y]) => [roundCoord(x), roundCoord(y)]) }));
  return {
    spaces,
    lanes,
    notes: 'Camera-specific calibration drawn in the operator console.'
  };
}

function updateNextCalibrationIds() {
  const numbers = (type, prefix) => calibrationTool.zones
    .filter((zone) => zone.type === type)
    .map((zone) => Number(String(zone.id).replace(prefix, '')))
    .filter(Number.isFinite);
  calibrationTool.nextSpaceNumber = Math.max(0, ...numbers('space', 'P')) + 1;
  calibrationTool.nextLaneNumber = Math.max(0, ...numbers('lane', 'lane_')) + 1;
}

function setSuggestedCalibrationId() {
  const type = app.querySelector('[data-calibration-type]')?.value || 'space';
  const input = app.querySelector('[data-calibration-id]');
  if (!input) return;
  input.value = type === 'lane' ? `lane_${calibrationTool.nextLaneNumber}` : `P${calibrationTool.nextSpaceNumber}`;
}

function syncCalibrationTextarea() {
  const textarea = app.querySelector('[data-vision-calibration]');
  if (!textarea) return;
  textarea.value = JSON.stringify(calibrationFromZones(), null, 2);
}

function readCalibrationTextarea() {
  const textarea = app.querySelector('[data-vision-calibration]');
  try {
    return JSON.parse(textarea?.value || '{}');
  } catch {
    setCalibrationStatus('Calibration JSON is invalid.', 'error');
    return null;
  }
}

function loadCalibrationIntoEditor(calibration, message = 'Calibration loaded.') {
  calibrationTool.zones = zonesFromCalibration(calibration);
  calibrationTool.draftPoints = [];
  updateNextCalibrationIds();
  setSuggestedCalibrationId();
  syncCalibrationTextarea();
  redrawCalibrationCanvas();
  setCalibrationStatus(message, calibrationTool.zones.length ? 'live' : '');
}

function loadFacilityCalibration(facilityId) {
  calibrationTool.loadedFacilityId = facilityId;
  const saved = calibrationForFacility(facilityId);
  loadCalibrationIntoEditor(saved || defaultVisionCalibration(), saved ? 'Saved facility calibration loaded.' : 'Template calibration loaded.');
}

function hydrateDetectionView() {
  const facilitySelect = app.querySelector('[data-vision-facility]');
  if (!facilitySelect) return;

  const facilities = workspaceFacilities();
  if (!visionRun.facilityId || !facilities.some((facility) => facility.id === visionRun.facilityId)) {
    visionRun.facilityId = facilitySelect.value || facilities[0]?.id || '';
  }
  if (visionRun.facilityId) facilitySelect.value = visionRun.facilityId;

  if (calibrationTool.loadedFacilityId !== visionRun.facilityId) {
    loadFacilityCalibration(visionRun.facilityId);
  } else {
    syncCalibrationTextarea();
    redrawCalibrationCanvas();
  }

  if (visionRun.file && !calibrationTool.frameCanvas) {
    loadCalibrationFrame(visionRun.file);
  }
}

function drawPolygon(context, zone, isDraft = false) {
  if (!zone.points.length) return;
  const color = zone.type === 'lane' ? '#576a71' : '#96b8cb';
  const accent = zone.type === 'lane' ? 'rgba(87, 106, 113, 0.22)' : 'rgba(150, 184, 203, 0.24)';
  context.beginPath();
  zone.points.forEach(([x, y], index) => {
    const px = x * calibrationTool.frameWidth;
    const py = y * calibrationTool.frameHeight;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  if (!isDraft) context.closePath();
  context.fillStyle = accent;
  context.strokeStyle = color;
  context.lineWidth = isDraft ? 3 : 4;
  if (!isDraft) context.fill();
  context.stroke();

  zone.points.forEach(([x, y]) => {
    context.beginPath();
    context.arc(x * calibrationTool.frameWidth, y * calibrationTool.frameHeight, 5, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    context.lineWidth = 2;
    context.stroke();
  });

  if (!isDraft) {
    const [x, y] = zone.points[0];
    context.font = '700 18px Inter, system-ui, sans-serif';
    context.fillStyle = '#f8f9f7';
    context.strokeStyle = 'rgba(0, 0, 0, 0.58)';
    context.lineWidth = 4;
    context.strokeText(zone.id, x * calibrationTool.frameWidth + 10, y * calibrationTool.frameHeight + 24);
    context.fillText(zone.id, x * calibrationTool.frameWidth + 10, y * calibrationTool.frameHeight + 24);
  }
}

function redrawCalibrationCanvas() {
  const canvas = app.querySelector('[data-calibration-canvas]');
  if (!canvas) return;
  canvas.width = calibrationTool.frameWidth;
  canvas.height = calibrationTool.frameHeight;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (calibrationTool.frameCanvas) {
    context.drawImage(calibrationTool.frameCanvas, 0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.18)';
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.fillStyle = '#11131d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(226, 229, 226, 0.12)';
    context.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += canvas.width / 8) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y <= canvas.height; y += canvas.height / 6) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  }

  calibrationTool.zones.forEach((zone) => drawPolygon(context, zone));
  const type = app.querySelector('[data-calibration-type]')?.value || 'space';
  const draft = { type, id: 'draft', points: [...calibrationTool.draftPoints] };
  if (calibrationTool.pointer && draft.points.length) draft.points.push(calibrationTool.pointer);
  drawPolygon(context, draft, true);
}

function captureCalibrationFrame(video) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  calibrationTool.frameWidth = width;
  calibrationTool.frameHeight = height;
  const frame = document.createElement('canvas');
  frame.width = width;
  frame.height = height;
  frame.getContext('2d').drawImage(video, 0, 0, width, height);
  calibrationTool.frameCanvas = frame;
  redrawCalibrationCanvas();
  setCalibrationStatus('Frame ready for calibration.', 'live');
}

function loadCalibrationFrame(file) {
  const video = app.querySelector('[data-calibration-video]');
  if (!video || !file) return;
  if (calibrationTool.videoUrl) URL.revokeObjectURL(calibrationTool.videoUrl);
  calibrationTool.videoUrl = URL.createObjectURL(file);
  calibrationTool.frameCanvas = null;
  video.src = calibrationTool.videoUrl;
  video.preload = 'metadata';
  video.load();
  video.onloadedmetadata = () => {
    const targetTime = Number.isFinite(video.duration) ? Math.min(1.2, Math.max(0.1, video.duration * 0.08)) : 0.1;
    video.currentTime = targetTime;
  };
  video.onseeked = () => captureCalibrationFrame(video);
  video.onloadeddata = () => {
    if (!calibrationTool.frameCanvas) captureCalibrationFrame(video);
  };
  video.onerror = () => setCalibrationStatus('This video codec cannot be previewed in the browser. Paste or load calibration JSON instead.', 'error');
  setCalibrationStatus('Loading calibration frame...');
}

function calibrationPointFromEvent(event) {
  const canvas = app.querySelector('[data-calibration-canvas]');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return [
    roundCoord((event.clientX - rect.left) / rect.width),
    roundCoord((event.clientY - rect.top) / rect.height)
  ];
}

function addCalibrationPoint(event) {
  const point = calibrationPointFromEvent(event);
  if (!point) return;
  calibrationTool.draftPoints.push(point);
  calibrationTool.pointer = null;
  redrawCalibrationCanvas();
  setCalibrationStatus(`${calibrationTool.draftPoints.length} point${calibrationTool.draftPoints.length === 1 ? '' : 's'} placed.`);
}

function finishCalibrationZone() {
  const type = app.querySelector('[data-calibration-type]')?.value || 'space';
  const input = app.querySelector('[data-calibration-id]');
  const id = String(input?.value || '').trim();
  if (calibrationTool.draftPoints.length < 3) {
    setCalibrationStatus('Place at least 3 points before finishing a zone.', 'error');
    return;
  }
  if (!id) {
    setCalibrationStatus('Enter a zone ID before finishing.', 'error');
    return;
  }
  calibrationTool.zones.push({ type, id, points: [...calibrationTool.draftPoints] });
  calibrationTool.draftPoints = [];
  updateNextCalibrationIds();
  setSuggestedCalibrationId();
  syncCalibrationTextarea();
  redrawCalibrationCanvas();
  setCalibrationStatus(`${id} added to calibration.`, 'live');
}

function clearCalibrationDraft() {
  if (calibrationTool.draftPoints.length) {
    calibrationTool.draftPoints = [];
  } else {
    calibrationTool.zones = [];
    updateNextCalibrationIds();
    setSuggestedCalibrationId();
    syncCalibrationTextarea();
  }
  redrawCalibrationCanvas();
  setCalibrationStatus('Calibration editor cleared.');
}

function downloadCalibrationJson() {
  const calibration = readCalibrationTextarea() || calibrationFromZones();
  const blob = new Blob([JSON.stringify(calibration, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sightline-camera-calibration.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function saveCalibration() {
  const facilityId = selectedVisionFacilityId();
  const calibration = readCalibrationTextarea();
  if (!facilityId) {
    setCalibrationStatus('Choose a facility before saving calibration.', 'error');
    return;
  }
  if (!calibration) return;

  try {
    const { workspace } = await api.saveCalibration({ facilityId, calibration });
    state.workspace = workspace;
    calibrationTool.loadedFacilityId = facilityId;
    refreshDetectionSurface(workspace);
    setCalibrationStatus('Calibration saved to SQLite.', 'live');
  } catch (error) {
    setCalibrationStatus(error.message, 'error');
  }
}

function setVideoStatus(message, tone = '') {
  const status = app.querySelector('[data-video-status]');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function stopVideoTestFeed(message = 'Video test stopped.') {
  if (videoTest.timer) window.clearInterval(videoTest.timer);
  videoTest.timer = null;
  videoTest.lastFrame = null;
  videoTest.lastEventAt = 0;
  videoTest.eventCount = 0;
  videoTest.pending = false;
  const video = app.querySelector('[data-video-preview]');
  if (video) video.pause();
  setVideoStatus(message);
}

function handleVideoFile(file) {
  stopVideoTestFeed('Footage loaded. Press Start live test when ready.');
  if (videoTest.url) URL.revokeObjectURL(videoTest.url);
  videoTest.url = URL.createObjectURL(file);
  const video = app.querySelector('[data-video-preview]');
  if (video) {
    video.src = videoTest.url;
    video.load();
  }
}

function isAcceptedVideoFile(file) {
  return Boolean(file && (file.type.startsWith('video/') || VIDEO_FILE_PATTERN.test(file.name)));
}

function isAcceptedTruthFile(file) {
  return Boolean(file && (
    file.type === 'application/json'
    || file.type === 'text/csv'
    || TRUTH_FILE_PATTERN.test(file.name)
  ));
}

function assignFileToInput(input, file) {
  if (!input || !file) return;
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    // Some browsers keep file inputs read-only for scripted drops. The app
    // still stores the file in memory for analysis in those cases.
  }
}

function handleVisionFile(file, input = app.querySelector('[data-vision-input]')) {
  if (!isAcceptedVideoFile(file)) {
    setVisionStatus('Drop a video file such as MOV, MP4, WebM, M4V, AVI, or MKV.', 'error');
    return false;
  }
  visionRun.file = file;
  assignFileToInput(input, file);
  loadCalibrationFrame(file);
  setVisionStatus(`${file.name} loaded. Start CV analysis when ready.`);
  appendVisionLine('Footage ready', `${file.name} · ${Math.max(1, Math.round(file.size / 1024 / 1024))} MB`);
  return true;
}

function handleTruthFile(file, input = app.querySelector('[data-truth-input]')) {
  if (!isAcceptedTruthFile(file)) {
    setVisionStatus('Ground truth must be a JSON or CSV file.', 'error');
    return false;
  }
  visionRun.truthFile = file;
  assignFileToInput(input, file);
  setVisionStatus(`${file.name} loaded. Analysis will run in validation mode.`);
  appendVisionLine('Ground truth ready', `${file.name} · events will be scored without writing to SQLite`);
  return true;
}

function frameSignature(video) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const width = 96;
  const height = 54;
  if (!videoTest.canvas) videoTest.canvas = document.createElement('canvas');
  videoTest.canvas.width = width;
  videoTest.canvas.height = height;
  const context = videoTest.canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const signature = [];
  for (let index = 0; index < data.length; index += 64) {
    signature.push(Math.round((data[index] + data[index + 1] + data[index + 2]) / 3));
  }
  return signature;
}

function motionScore(current, previous) {
  if (!current || !previous || current.length !== previous.length) return 0;
  const delta = current.reduce((sum, value, index) => sum + Math.abs(value - previous[index]), 0) / current.length;
  return Math.max(0, Math.min(100, Math.round(delta * 3.2)));
}

async function publishVideoDetection(score) {
  const facilitySelect = app.querySelector('[data-video-facility]');
  const eventMode = app.querySelector('[data-video-event-mode]')?.value || 'auto';
  const facilityId = facilitySelect?.value;
  if (!facilityId || videoTest.pending) return;

  const now = Date.now();
  if (now - videoTest.lastEventAt < 1350) return;
  videoTest.lastEventAt = now;
  videoTest.pending = true;

  const eventType = eventMode === 'auto'
    ? videoTest.eventCount % 4 === 1 ? 'space_opened' : 'vehicle_entered'
    : eventMode;
  const confidence = Math.max(72, Math.min(99, 78 + Math.round(score * 0.45)));
  const delta = eventType === 'vehicle_entered' ? 1 : eventType === 'space_opened' ? -1 : 0;

  try {
    const { workspace } = await api.cameraEvent({
      facilityId,
      eventType,
      confidence,
      motionScore: score,
      delta
    });
    state.workspace = workspace;
    videoTest.eventCount += 1;
    refreshDetectionSurface(workspace);
    setVideoStatus(`Live test running · ${videoTest.eventCount} event${videoTest.eventCount === 1 ? '' : 's'} recorded · latest motion score ${score}.`, 'live');
  } catch (error) {
    setVideoStatus(error.message, 'error');
  } finally {
    videoTest.pending = false;
  }
}

async function startVideoTestFeed() {
  const video = app.querySelector('[data-video-preview]');
  const thresholdInput = app.querySelector('[data-video-threshold]');
  const threshold = Math.max(4, Math.min(80, Number(thresholdInput?.value || 18)));
  if (!video?.src) {
    setVideoStatus('Choose a video file first.', 'error');
    return;
  }

  stopVideoTestFeed('Starting local video detector...');
  video.loop = true;
  video.muted = true;
  await video.play();
  setVideoStatus('Live test running · waiting for motion.', 'live');

  videoTest.timer = window.setInterval(() => {
    const current = frameSignature(video);
    const score = motionScore(current, videoTest.lastFrame);
    videoTest.lastFrame = current;
    if (score >= threshold) publishVideoDetection(score);
  }, 650);
}

function setVisionStatus(message, tone = '') {
  const status = app.querySelector('[data-vision-status]');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function appendVisionLine(title, detail = '') {
  const output = app.querySelector('[data-vision-output]');
  if (!output) return;
  const row = document.createElement('div');
  row.className = 'vision-line';
  row.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}`;
  output.prepend(row);
  while (output.children.length > 8) output.lastElementChild?.remove();
}

function stopVisionAnalysis(message = 'CV analysis stopped.') {
  if (visionRun.controller) visionRun.controller.abort();
  visionRun.controller = null;
  visionRun.active = false;
  setVisionStatus(message);
}

function handleVisionPayload(payload) {
  if (!payload || !payload.type) return;
  if (payload.workspace) {
    state.workspace = payload.workspace;
    refreshDetectionSurface(payload.workspace);
  }

  if (payload.type === 'started') {
    setVisionStatus(payload.message || 'Vision detector started.', 'live');
    appendVisionLine('Started', 'Local detector process is running.');
  }
  if (payload.type === 'calibration') {
    setVisionStatus(`Calibration loaded · ${payload.spaces?.length || 0} spaces · ${payload.lanes?.length || 0} lanes.`, 'live');
    appendVisionLine('Calibration', `${payload.spaces?.length || 0} stall zones, ${payload.lanes?.length || 0} lane zones, ${payload.duration || 0}s clip.`);
  }
  if (payload.type === 'ground_truth') {
    setVisionStatus(`Ground truth loaded · ${payload.events} event${payload.events === 1 ? '' : 's'} · ±${payload.toleranceSeconds}s.`, 'live');
    appendVisionLine('Ground truth', `${payload.events} labeled events · tolerance ${payload.toleranceSeconds}s.`);
  }
  if (payload.type === 'progress') {
    setVisionStatus(`Analyzing real footage · ${payload.videoSecond}s · ${payload.detections} vehicle candidate${payload.detections === 1 ? '' : 's'}.`, 'live');
  }
  if (payload.type === 'event') {
    visionRun.events += 1;
    const modeLabel = payload.validationOnly ? 'validation event' : 'event written to SQLite';
    setVisionStatus(`Live CV analysis · ${visionRun.events} ${modeLabel}${visionRun.events === 1 ? '' : 's'}.`, 'live');
    appendVisionLine(payload.eventType.replaceAll('_', ' '), `${payload.spaceId || 'scene'} · ${payload.confidence}% confidence · ${payload.message || ''}`);
  }
  if (payload.type === 'validation') {
    const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
    const latency = payload.meanLatencySeconds === null ? 'No matched latency yet' : `${payload.meanLatencySeconds}s avg latency`;
    setVisionStatus(`Validation complete · Precision ${pct(payload.precision)} · Recall ${pct(payload.recall)} · F1 ${pct(payload.f1)}.`, payload.f1 >= 0.75 ? 'live' : 'error');
    appendVisionLine('Validation report', `TP ${payload.truePositives} · FP ${payload.falsePositives} · FN ${payload.falseNegatives} · ${latency}`);
    (payload.warnings || []).forEach((warning) => {
      appendVisionLine('Validation warning', warning);
    });
    (payload.confidenceBuckets || []).forEach((bucket) => {
      appendVisionLine(`${bucket.bucket}% confidence`, `${bucket.correct}/${bucket.total} correct · ${pct(bucket.accuracy)} observed accuracy`);
    });
    if (payload.missed?.length) {
      appendVisionLine('Missed events', payload.missed.slice(0, 3).map((event) => `${event.eventType} ${event.spaceId || ''} @ ${event.time}s`).join(' · '));
    }
    if (payload.falsePositiveSamples?.length) {
      appendVisionLine('False positives', payload.falsePositiveSamples.slice(0, 3).map((event) => `${event.eventType} ${event.spaceId || ''} @ ${event.videoSecond || event.timestamp}s`).join(' · '));
    }
  }
  if (payload.type === 'warning') appendVisionLine('Warning', payload.message || '');
  if (payload.type === 'setup_required') {
    setVisionStatus(payload.message, 'error');
    appendVisionLine('Setup required', payload.install || payload.message || '');
  }
  if (payload.type === 'error') {
    setVisionStatus(payload.message || 'Vision detector failed.', 'error');
    appendVisionLine('Error', payload.message || '');
  }
  if (payload.type === 'summary') {
    setVisionStatus(`CV analysis complete · ${payload.events} event${payload.events === 1 ? '' : 's'} · ${payload.detector}.`, 'live');
    const modelLabel = payload.model ? ` (${payload.model})` : '';
    const fallbackLabel = payload.fallbackModel ? ` · fallback ${payload.fallbackModel}` : '';
    appendVisionLine('Summary', `${payload.processedFrames} sampled frames in ${payload.runtimeSeconds}s using ${payload.detector}${modelLabel}${fallbackLabel}.`);
  }
  if (payload.type === 'complete') {
    visionRun.active = false;
    visionRun.controller = null;
  }
}

async function startVisionAnalysis() {
  const fileInput = app.querySelector('[data-vision-input]');
  const facilityId = app.querySelector('[data-vision-facility]')?.value;
  const calibration = app.querySelector('[data-vision-calibration]')?.value || '{}';
  const confidence = app.querySelector('[data-vision-confidence]')?.value || '0.55';
  const model = app.querySelector('[data-vision-model]')?.value || 'auto';
  const sampleRate = app.querySelector('[data-vision-sample-rate]')?.value || '4';
  const file = visionRun.file || fileInput?.files?.[0];
  const truthInput = app.querySelector('[data-truth-input]');
  const truthFile = visionRun.truthFile || truthInput?.files?.[0];
  visionRun.facilityId = facilityId || visionRun.facilityId;

  if (!facilityId) {
    setVisionStatus('Choose a facility before analysis.', 'error');
    return;
  }
  if (!file) {
    setVisionStatus('Upload real parking-lot footage first.', 'error');
    return;
  }
  if (!isAcceptedVideoFile(file)) {
    setVisionStatus('Use a video file such as MOV, MP4, WebM, M4V, AVI, or MKV.', 'error');
    return;
  }
  if (truthFile && !isAcceptedTruthFile(truthFile)) {
    setVisionStatus('Ground truth must be a JSON or CSV file.', 'error');
    return;
  }

  try {
    JSON.parse(calibration || '{}');
  } catch {
    setVisionStatus('Calibration JSON is invalid.', 'error');
    return;
  }

  stopVideoTestFeed('Motion smoke test stopped while CV analysis started.');
  if (visionRun.active) stopVisionAnalysis('Restarting CV analysis...');
  visionRun.controller = new AbortController();
  visionRun.active = true;
  visionRun.events = 0;
  app.querySelector('[data-vision-output]')?.replaceChildren();
  setVisionStatus('Uploading footage to the local detector...', 'live');

  const body = new FormData();
  body.append('facilityId', facilityId);
  body.append('video', file);
  body.append('calibration', calibration);
  body.append('confidence', confidence);
  body.append('sampleRate', sampleRate);
  body.append('model', model);
  if (truthFile) {
    body.append('groundTruth', truthFile);
    body.append('persistEvents', 'false');
  } else {
    body.append('persistEvents', 'true');
  }

  try {
    const response = await api.visionAnalyze(body, { signal: visionRun.controller.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Vision analysis failed.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.map((line) => line.trim()).filter(Boolean).forEach((line) => {
        try {
          handleVisionPayload(JSON.parse(line));
        } catch {
          appendVisionLine('Detector log', line);
        }
      });
    }
    if (buffer.trim()) handleVisionPayload(JSON.parse(buffer.trim()));
  } catch (error) {
    if (error.name === 'AbortError') {
      setVisionStatus('CV analysis stopped.');
    } else {
      setVisionStatus(error.message, 'error');
      appendVisionLine('Error', error.message);
    }
  } finally {
    visionRun.active = false;
    visionRun.controller = null;
  }
}

async function loadWorkspace() {
  const { workspace } = await api.workspace();
  setState({ user: workspace.user, workspace, error: '', notice: '' });
}

async function initialize() {
  try {
    const [{ user }, { workspace }] = await Promise.all([api.me(), api.workspace()]);
    setState({ loading: false, user, workspace });
  } catch {
    setState({ loading: false, user: null, workspace: null });
  }
}

app.addEventListener('click', async (event) => {
  const authMode = event.target.closest('[data-auth-mode]')?.dataset.authMode;
  if (authMode) {
    setState({ authMode, error: '', notice: '' });
    return;
  }

  const launchAuth = event.target.closest('[data-launch-platform]');
  if (launchAuth) {
    navigate('/auth', { authMode: 'login' });
    return;
  }

  const backStory = event.target.closest('[data-back-story]');
  if (backStory) {
    navigate('/');
    return;
  }

  const sceneButton = event.target.closest('[data-scene-index]');
  if (sceneButton) {
    sceneLockUntil = Date.now() + SCENE_TRANSITION_LOCK_MS;
    setSceneIndex(Number(sceneButton.dataset.sceneIndex) || 0);
    return;
  }

  if (event.target.closest('[data-next-story], [data-next-scene]')) {
    stepScene(1);
    return;
  }

  const view = event.target.closest('[data-view]')?.dataset.view;
  if (view) {
    if (state.view === 'detection' && view !== 'detection') stopVideoTestFeed();
    if (state.view === 'detection' && view !== 'detection' && visionRun.active) stopVisionAnalysis();
    setState({ view });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  try {
    if (action === 'theme') {
      if (videoTest.timer) stopVideoTestFeed('Video test stopped while switching theme.');
      if (visionRun.active) stopVisionAnalysis('CV analysis stopped while switching theme.');
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
      return;
    }
    if (action === 'vision-start') {
      await startVisionAnalysis();
      return;
    }
    if (action === 'vision-stop') {
      stopVisionAnalysis();
      return;
    }
    if (action === 'calibration-add-zone') {
      finishCalibrationZone();
      return;
    }
    if (action === 'calibration-undo-point') {
      calibrationTool.draftPoints.pop();
      redrawCalibrationCanvas();
      setCalibrationStatus('Last point removed.');
      return;
    }
    if (action === 'calibration-clear') {
      clearCalibrationDraft();
      return;
    }
    if (action === 'calibration-import-json') {
      const calibration = readCalibrationTextarea();
      if (calibration) loadCalibrationIntoEditor(calibration, 'Calibration JSON loaded into editor.');
      return;
    }
    if (action === 'calibration-download') {
      downloadCalibrationJson();
      return;
    }
    if (action === 'calibration-save') {
      await saveCalibration();
      return;
    }
    if (action === 'video-test-start') {
      await startVideoTestFeed();
      return;
    }
    if (action === 'video-test-stop') {
      stopVideoTestFeed();
      return;
    }
    if (action === 'logout') {
      stopVideoTestFeed();
      if (visionRun.active) stopVisionAnalysis();
      await api.logout();
      navigate('/auth', { user: null, workspace: null, authMode: 'login', notice: 'Logged out.', view: 'overview' });
    }
    if (action === 'refresh') {
      if (videoTest.timer) stopVideoTestFeed('Video test stopped while refreshing data.');
      if (visionRun.active) stopVisionAnalysis('CV analysis stopped while refreshing data.');
      await loadWorkspace();
    }
    if (action === 'scan') {
      if (videoTest.timer) stopVideoTestFeed('Video test stopped while running a scan.');
      if (visionRun.active) stopVisionAnalysis('CV analysis stopped while running a scan.');
      const { workspace } = await api.scan();
      setState({ workspace, notice: 'Camera scan saved.', error: '' });
    }
    if (action === 'reassign') {
      const { workspace } = await api.reassign();
      setState({ workspace, notice: 'Mobile app assignment synced.', error: '' });
    }
  } catch (error) {
    setState({ error: error.message, notice: '' });
  }
});

app.addEventListener('change', (event) => {
  const input = closestElement(event.target, '[data-video-input]');
  if (input?.files?.length) {
    if (!isAcceptedVideoFile(input.files[0])) {
      setVideoStatus('Choose a video file such as MOV, MP4, WebM, M4V, AVI, or MKV.', 'error');
      return;
    }
    handleVideoFile(input.files[0]);
    return;
  }

  const visionInput = closestElement(event.target, '[data-vision-input]');
  if (visionInput?.files?.length) {
    handleVisionFile(visionInput.files[0], visionInput);
  }

  const truthInput = closestElement(event.target, '[data-truth-input]');
  if (truthInput?.files?.length) {
    handleTruthFile(truthInput.files[0], truthInput);
    return;
  }

  const facilitySelect = closestElement(event.target, '[data-vision-facility]');
  if (facilitySelect) {
    visionRun.facilityId = facilitySelect.value;
    loadFacilityCalibration(visionRun.facilityId);
    return;
  }

  const calibrationType = closestElement(event.target, '[data-calibration-type]');
  if (calibrationType) {
    setSuggestedCalibrationId();
    redrawCalibrationCanvas();
  }
});

app.addEventListener('pointermove', (event) => {
  if (!closestElement(event.target, '[data-calibration-canvas]')) return;
  calibrationTool.pointer = calibrationPointFromEvent(event);
  redrawCalibrationCanvas();
});

app.addEventListener('pointerleave', (event) => {
  if (!closestElement(event.target, '[data-calibration-canvas]')) return;
  calibrationTool.pointer = null;
  redrawCalibrationCanvas();
});

app.addEventListener('click', (event) => {
  if (!closestElement(event.target, '[data-calibration-canvas]')) return;
  addCalibrationPoint(event);
});

app.addEventListener('dblclick', (event) => {
  if (!closestElement(event.target, '[data-calibration-canvas]')) return;
  event.preventDefault();
  finishCalibrationZone();
});

function closestDropZone(target) {
  return closestElement(target, '[data-video-drop], [data-vision-drop], [data-truth-drop]');
}

function setDropActive(dropZone, active) {
  if (dropZone) dropZone.classList.toggle('is-dragging', active);
}

app.addEventListener('dragenter', (event) => {
  const dropZone = closestDropZone(event.target);
  if (!dropZone) return;
  event.preventDefault();
  setDropActive(dropZone, true);
});

app.addEventListener('dragover', (event) => {
  const dropZone = closestDropZone(event.target);
  if (!dropZone) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  setDropActive(dropZone, true);
});

app.addEventListener('dragleave', (event) => {
  const dropZone = closestDropZone(event.target);
  if (!dropZone || dropZone.contains(event.relatedTarget)) return;
  setDropActive(dropZone, false);
});

app.addEventListener('drop', (event) => {
  const dropZone = closestDropZone(event.target);
  if (!dropZone) return;
  event.preventDefault();
  setDropActive(dropZone, false);

  const isTruthDrop = dropZone.matches('[data-truth-drop]');
  const file = Array.from(event.dataTransfer.files || []).find(isTruthDrop ? isAcceptedTruthFile : isAcceptedVideoFile);
  if (!file) {
    const message = isTruthDrop
      ? 'Drop a JSON or CSV ground-truth file.'
      : 'Drop a video file such as MOV, MP4, WebM, M4V, AVI, or MKV.';
    if (dropZone.matches('[data-vision-drop], [data-truth-drop]')) setVisionStatus(message, 'error');
    else setVideoStatus(message, 'error');
    return;
  }

  const input = dropZone.querySelector('input[type="file"]');
  assignFileToInput(input, file);
  if (isTruthDrop) {
    handleTruthFile(file, input);
  } else if (dropZone.matches('[data-vision-drop]')) {
    handleVisionFile(file, input);
  } else {
    handleVideoFile(file);
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();

  const type = form.dataset.form;
  try {
    if (type === 'register') {
      const payload = formData(form);
      const { user, workspace } = await api.register(payload);
      setState({ user, workspace, route: '/app', error: '', notice: '', view: 'overview' });
      if (window.location.pathname !== '/app') window.history.pushState({}, '', '/app');
    }

    if (type === 'login') {
      const { user, workspace } = await api.login(formData(form));
      setState({ user, workspace, route: '/app', error: '', notice: '', view: 'overview' });
      if (window.location.pathname !== '/app') window.history.pushState({}, '', '/app');
    }

    if (type === 'facility') {
      const { workspace } = await api.addFacility(formData(form));
      setState({ workspace, error: '', notice: 'Facility saved to SQLite.' });
    }
  } catch (error) {
    setState({ error: error.message, notice: '' });
  }
});

window.addEventListener('wheel', (event) => {
  if (!isStoryMode()) return;

  const now = Date.now();
  const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  const direction = Math.sign(dominantDelta);
  if (!direction || canScrollWithinActiveScene(event.target, direction)) return;

  event.preventDefault();

  if (now < sceneLockUntil) {
    wheelDelta = 0;
    lastWheelAt = now;
    return;
  }

  if (now - lastWheelAt > SCENE_WHEEL_IDLE_RESET_MS || Math.sign(wheelDelta) !== direction) {
    wheelDelta = 0;
  }

  lastWheelAt = now;
  const normalizedDelta = Math.max(-SCENE_WHEEL_DELTA_LIMIT, Math.min(SCENE_WHEEL_DELTA_LIMIT, dominantDelta));
  wheelDelta += normalizedDelta;

  if (Math.abs(wheelDelta) >= SCENE_SCROLL_THRESHOLD) {
    stepScene(Math.sign(wheelDelta));
  }
}, { passive: false });

window.addEventListener('keydown', (event) => {
  if (!isStoryMode() || isTypingTarget(event.target)) return;

  const nextKeys = new Set(['ArrowDown', 'PageDown', ' ', 'Enter']);
  const previousKeys = new Set(['ArrowUp', 'PageUp']);

  if (nextKeys.has(event.key)) {
    event.preventDefault();
    stepScene(1);
  }

  if (previousKeys.has(event.key)) {
    event.preventDefault();
    stepScene(-1);
  }

  if (event.key === 'Home') {
    event.preventDefault();
    setSceneIndex(0);
  }

  if (event.key === 'End') {
    event.preventDefault();
    setSceneIndex(STORY_SCENE_COUNT - 1);
  }
});

window.addEventListener('touchstart', (event) => {
  if (!isStoryMode() || !event.touches.length) return;

  touchStartY = event.touches[0].clientY;
  touchStartX = event.touches[0].clientX;
  touchStartTarget = event.target;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (!isStoryMode() || touchStartY === null || !event.touches.length) return;

  const deltaY = touchStartY - event.touches[0].clientY;
  const deltaX = touchStartX - event.touches[0].clientX;
  if (Math.abs(deltaY) < TOUCH_SCENE_THRESHOLD || Math.abs(deltaY) < Math.abs(deltaX)) return;

  const direction = Math.sign(deltaY);
  if (canScrollWithinActiveScene(touchStartTarget || event.target, direction)) return;

  event.preventDefault();
  stepScene(direction);
  touchStartY = null;
  touchStartX = null;
  touchStartTarget = null;
}, { passive: false });

window.addEventListener('touchend', () => {
  touchStartY = null;
  touchStartX = null;
  touchStartTarget = null;
});

window.addEventListener('popstate', () => {
  setState({ route: window.location.pathname, error: '', notice: '' });
});

initialize();
