import { api } from './api.js';
import { renderAuth, STORY_SCENE_COUNT } from './views/auth.js';
import { renderShell } from './views/dashboard.js';

const app = document.getElementById('app');
const SCENE_SCROLL_THRESHOLD = 72;
const SCENE_TRANSITION_LOCK_MS = 620;

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
    sceneLockUntil = now + SCENE_TRANSITION_LOCK_MS;
  }
  return changed;
}

function isTypingTarget(target) {
  return Boolean(closestElement(target, 'input, textarea, select, [contenteditable="true"]'));
}

function canScrollWithinActiveScene(target, direction) {
  const scene = closestElement(target, '.story-scene.active');
  if (!scene || scene.scrollHeight <= scene.clientHeight + 2) return false;
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

  const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  const direction = Math.sign(dominantDelta);
  if (!direction || canScrollWithinActiveScene(event.target, direction)) return;

  event.preventDefault();
  wheelDelta += dominantDelta;
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
  if (Math.abs(deltaY) < 58 || Math.abs(deltaY) < Math.abs(deltaX)) return;

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
