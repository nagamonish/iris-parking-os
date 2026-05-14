import { api } from './api.js';
import { renderAuth, STORY_SCENE_COUNT } from './views/auth.js';
import { renderShell } from './views/dashboard.js';

const app = document.getElementById('app');
const SCENE_SCROLL_THRESHOLD = 132;
const SCENE_TRANSITION_LOCK_MS = 1850;
const SCENE_WHEEL_IDLE_RESET_MS = 520;
const SCENE_WHEEL_DELTA_LIMIT = 46;
const TOUCH_SCENE_THRESHOLD = 112;
const STORY_SCENE_KEYS = ['intro', 'engine', 'location', 'nearby', 'route', 'reroute', 'operator'];
const ROUTE_PATHS = {
  p7: 'M 50 92 L 50 60 L 86 60 L 86 21',
  p3: 'M 50 92 L 50 60 L 24 60 L 24 21'
};

const state = {
  loading: true,
  user: null,
  workspace: null,
  view: 'overview',
  authMode: 'register',
  authVisible: false,
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

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function render() {
  if (state.loading) {
    app.innerHTML = '<main class="landing"><section class="landing-grid"><div class="hero-panel"><h1>IRIS<span>.</span></h1><p class="hero-copy">Loading workspace...</p></div></section></main>';
    return;
  }

  app.innerHTML = state.user && state.workspace
    ? renderShell(state)
    : renderAuth(state);

  queueMicrotask(scheduleStorySceneEffects);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function isSignedIn() {
  return Boolean(state.user && state.workspace);
}

function isStoryMode() {
  return !state.loading && !isSignedIn();
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
      moveDriver('1', '49%', '58%', 1480);
      moveDriver('1', '84%', '58%', 2050);
      moveDriver('1', '84%', '19%', 2620);
    }

    if (sceneKey === 'reroute') {
      addOn('#hud2', 180);
      addOn('#spotCard2', 420);
      addOn('#routeMain2', 700);
      addOn('#routeFlow2', 880);
      addOn('#driver2', 920);
      moveDriver('2', '49%', '88%', 940);
      moveDriver('2', '49%', '58%', 1460);
      moveDriver('2', '70%', '58%', 2020);
      addOn('#rerouteBanner', 2400);
      after(2440, () => {
        sceneElement('#sp7b')?.classList.remove('target');
        sceneElement('#sp7b')?.classList.add('taken');
        sceneElement('#sp3b')?.classList.remove('open');
        sceneElement('#sp3b')?.classList.add('target-green');
      });
      setRoutePath('2', 'p3', 2500);
      setSceneText('#hud2Text', 'Head to <span>P3</span>', 2500);
      setSceneText('#spotLabel', 'Spot P3', 2500);
      setSceneText('#spotDist', '90 ft', 2500);
      moveDriver('2', '49%', '58%', 2760);
      moveDriver('2', '23%', '58%', 3360);
      moveDriver('2', '23%', '19%', 3960);
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
    setState({ authMode, authVisible: true, error: '', notice: '' });
    return;
  }

  const launchAuth = event.target.closest('[data-launch-platform]');
  if (launchAuth) {
    setState({ authVisible: true, authMode: 'login', error: '', notice: '' });
    return;
  }

  const closeAuth = event.target.closest('[data-close-auth]');
  if (closeAuth) {
    setState({ authVisible: false, error: '', notice: '' });
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
    setState({ view });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  try {
    if (action === 'logout') {
      await api.logout();
      setState({ user: null, workspace: null, authMode: 'login', authVisible: false, notice: 'Logged out.', view: 'overview' });
    }
    if (action === 'refresh') await loadWorkspace();
    if (action === 'scan') {
      const { workspace } = await api.scan();
      setState({ workspace, notice: 'Camera scan saved.', error: '' });
    }
    if (action === 'reassign') {
      const { workspace } = await api.reassign();
      setState({ workspace, notice: 'Driver assignment updated.', error: '' });
    }
  } catch (error) {
    setState({ error: error.message, notice: '' });
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
      setState({ user, workspace, authVisible: false, error: '', notice: '', view: 'overview' });
    }

    if (type === 'login') {
      const { user, workspace } = await api.login(formData(form));
      setState({ user, workspace, authVisible: false, error: '', notice: '', view: 'overview' });
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
  if (!isStoryMode() || state.authVisible || closestElement(event.target, '.platform-auth-panel')) return;

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
  if (!isStoryMode() || state.authVisible || isTypingTarget(event.target)) return;

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
  if (!isStoryMode() || state.authVisible || !event.touches.length) return;

  touchStartY = event.touches[0].clientY;
  touchStartX = event.touches[0].clientX;
  touchStartTarget = event.target;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (!isStoryMode() || state.authVisible || touchStartY === null || !event.touches.length) return;

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

initialize();
