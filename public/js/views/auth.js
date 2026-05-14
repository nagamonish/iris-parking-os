import { brand, escapeHtml } from '../components.js';

const scenes = [
  { label: 'Brand', title: 'Sightline.', kind: 'intro' },
  { label: 'IRIS AI', title: 'IRIS.', kind: 'engine' },
  { label: 'Location', title: 'Check before you drive.', kind: 'location' },
  { label: 'Availability', title: 'See every deck nearby.', kind: 'nearby' },
  { label: 'Assignment', title: 'Straight to the open spot.', kind: 'route' },
  { label: 'Reroute', title: 'Next-nearest, automatically.', kind: 'reroute' },
  { label: 'Operator', title: 'Every lot. One dashboard.', kind: 'operator' }
];

export const STORY_SCENE_COUNT = scenes.length;

export function renderAuth(state) {
  const activeIndex = Math.max(0, Math.min(scenes.length - 1, Number(state.sceneIndex || 0)));
  const isRegister = state.authMode === 'register';

  return `
    <main class="story-shell">
      <div class="story-stage" aria-label="Sightline product slideshow">
        ${scenes.map((scene, index) => `
          <section class="story-scene ${index === activeIndex ? 'active' : ''}" data-scene-kind="${scene.kind}" aria-hidden="${index === activeIndex ? 'false' : 'true'}">
            ${renderScene(scene, index)}
          </section>
        `).join('')}
      </div>

      <nav class="story-side-nav" aria-label="Slideshow navigation">
        ${scenes.map((scene, index) => `
          <button class="${index === activeIndex ? 'active' : ''}" type="button" data-scene-index="${index}" aria-label="Go to ${escapeHtml(scene.label)}"></button>
        `).join('')}
      </nav>

      <button class="story-next" type="button" data-next-scene aria-label="Go to next section">
        <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 24 L32 40 L46 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </button>

      <aside class="platform-auth-panel ${state.authVisible ? 'open' : ''}" aria-hidden="${state.authVisible ? 'false' : 'true'}">
        <div class="auth-panel-head">
          ${brand()}
          <button class="icon-button" type="button" data-close-auth aria-label="Close platform access">x</button>
        </div>
        <h2>${isRegister ? 'Create your workspace' : 'Welcome back'}</h2>
        <p>${isRegister ? 'Accounts are stored in SQLite with persistent sessions.' : 'Log back into your persisted IRIS workspace.'}</p>
        <div class="auth-tabs">
          <button class="auth-tab ${isRegister ? 'active' : ''}" data-auth-mode="register">Register</button>
          <button class="auth-tab ${!isRegister ? 'active' : ''}" data-auth-mode="login">Login</button>
        </div>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
        ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ''}
        ${isRegister ? registerForm() : loginForm()}
      </aside>
    </main>
  `;
}

function renderScene(scene, index) {
  if (scene.kind === 'intro') return introScene();
  if (scene.kind === 'engine') return engineScene();
  if (scene.kind === 'location') return phoneScene('Location awareness', scene.title, 'Enter any address. See live occupancy before you leave the house. Percentage, color, and open spaces stay in sync.', locationPhone());
  if (scene.kind === 'nearby') return phoneScene('Lot awareness', scene.title, 'Sightline shows parking decks around you live. Color and percent tell you instantly whether a lot is open, filling, or full.', nearbyPhone());
  if (scene.kind === 'route') return phoneScene('Driver 1 - inside the lot', scene.title, 'Once inside a Sightline-enabled lot, cameras know exactly which spots are open and route the driver there.', routePhone('P7', false));
  if (scene.kind === 'reroute') return phoneScene('Driver 2 - behind them', scene.title, 'The moment P7 is taken, Sightline reroutes the next driver to P3. No conflict. No circling.', routePhone('P3', true));
  return operatorScene(index);
}

function introScene() {
  return `
    <div class="title-wrap">
      <div class="original-intro">
        <div class="product-demo-label">Sightline · Product demo</div>
        <div class="wordmark">Sightline<span>.</span></div>
        <div class="tagline">Never circle again</div>
      </div>
    </div>
  `;
}

function engineScene() {
  return `
    <div class="engine-wrap">
      <div class="engine-eyebrow" id="engineEyebrow">Powered by</div>
      <div class="engine-name" id="engineName">IRIS<span>.</span></div>
      <div class="engine-expand" id="engineExpand">INFINITE REAL-TIME INTELLIGENCE SYSTEM</div>
      <div class="engine-desc" id="engineDesc">The AI engine behind Sightline. IRIS turns parking cameras into live inventory, assignment, and rerouting intelligence.</div>
      <div class="engine-pillars">
        <div class="pillar" id="p1"><div class="pn">01</div><div class="ph">Sees</div><div class="ps">Every camera feed</div></div>
        <div class="pillar" id="p2"><div class="pn">02</div><div class="ph">Learns</div><div class="ps">Lot geometry</div></div>
        <div class="pillar" id="p3"><div class="pn">03</div><div class="ph">Tells</div><div class="ps">Drivers and operators</div></div>
      </div>
    </div>
  `;
}

function phoneScene(eyebrow, title, body, phoneHtml) {
  return `
    <div class="two-col">
      <div class="side-label">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
        <div class="caption">Sightline product story</div>
      </div>
      ${phoneHtml}
    </div>
  `;
}

function phoneFrame(content) {
  return `
    <div class="phone">
      <div class="screen">
        <div class="status-bar">
          <div>9:41</div>
          <div class="status-icons"><div class="bars"><div></div><div></div><div></div><div></div></div><div class="battery"><div class="battery-fill"></div></div></div>
        </div>
        ${content}
      </div>
    </div>
  `;
}

function locationPhone() {
  return phoneFrame(`
    <div class="app-header"><div class="brand">Sightline</div><div class="h">Check a destination</div></div>
    <div class="search-input"><span class="typed-address" id="typedAddr">400 S Tryon St, Charlotte</span><span class="caret"></span></div>
    <div class="location-card" id="locCard">
      <div class="name">Bank of America Tower</div>
      <div class="addr">400 S Tryon St - Uptown Charlotte</div>
      <div class="occ-row">
        <div><div class="occ-label">Occupancy</div><div class="big-occ full"><span class="pct">87</span><span class="unit">%</span></div></div>
        <div class="open-count"><div class="occ-label">Open spots</div><strong>13</strong></div>
      </div>
      <div class="occ-bar"><div class="occ-fill" id="occFill"></div></div>
      <div class="live-chip"><div class="dot"></div>LIVE - UPDATED 0.4s AGO</div>
    </div>
  `);
}

function nearbyPhone() {
  const lots = [
    ['7th Street Deck', '0.2 mi - 400 spots', '94% - Full', 'full'],
    ['Parking Deck A', '0.4 mi - 200 spots', '34% - Open', 'open'],
    ['Stonewall Garage', '0.5 mi - 280 spots', '71% - Filling', 'filling'],
    ['College St Lot', '0.7 mi - 120 spots', '22% - Open', 'open']
  ];

  return phoneFrame(`
    <div class="app-header"><div class="brand">Sightline</div><div class="h">Nearby decks</div></div>
    <div class="nearby-list">
      ${lots.map(([name, detail, status, tone], index) => `
        <div class="nearby-card" id="nearby${index + 1}">
          <div class="info"><div class="n">${escapeHtml(name)}</div><div class="d">${escapeHtml(detail)}</div></div>
          <div class="phone-pill ${tone}">${escapeHtml(status)}</div>
        </div>
      `).join('')}
    </div>
  `);
}

function routePhone(spot, rerouted) {
  const activeSpot = rerouted ? 'P7' : spot;
  const pathToP7 = 'M 50 94 C 50 84 50 76 50 68 C 50 61 56 57 63 57 L 63 50';
  const pathToP3 = 'M 50 94 C 50 82 50 75 50 68 C 50 61 56 57 63 57 L 63 17';
  const initialPath = activeSpot === 'P3' ? pathToP3 : pathToP7;
  const targetClass = activeSpot === 'P3' ? 'target-green' : 'target';
  const prefix = rerouted ? '2' : '1';
  return phoneFrame(`
    <div class="lot-view">
      ${rerouted ? '<div class="reroute-banner" id="rerouteBanner"><div class="icon"></div><div>P7 just taken - rerouting to P3</div></div>' : ''}
      <div class="inlot-hud" id="hud${prefix}">
        <div class="arrow">➜</div>
        <div class="text"><div class="dist" id="hud${prefix}Text">Head to <span>${activeSpot}</span></div><div class="instr">Row 1 - 60 ft ahead</div></div>
      </div>
      <div class="lot-diagram">
        <div class="lot-title-chip"><div class="dot"></div><div class="l">PARKING DECK A - LEVEL 2</div></div>
        <div class="lot-grid">
          ${['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'].map((item) => `
            <div class="lot-spot ${item === activeSpot ? targetClass : item === 'P3' || item === 'P9' ? 'open' : 'taken'}" ${rerouted && item === 'P3' ? 'id="sp3b"' : ''} ${rerouted && item === 'P7' ? 'id="sp7b"' : ''}>${item}</div>
          `).join('')}
          <svg class="route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path class="route-path halo" id="routeHalo${prefix}" d="${initialPath}" pathLength="1"></path>
            <path class="route-path main ${activeSpot === 'P3' ? 'green' : ''}" id="routeMain${prefix}" d="${initialPath}" pathLength="1"></path>
            <path class="route-flow ${activeSpot === 'P3' ? 'green' : ''}" id="routeFlow${prefix}" d="${initialPath}" pathLength="1"></path>
          </svg>
          <div class="driver-dot" id="driver${prefix}"></div>
        </div>
      </div>
      <div class="spot-info-card" id="spotCard${prefix}"><div><strong id="spotLabel${prefix}">Spot ${activeSpot}</strong><span id="spotSub${prefix}">Level 2 - reserved for you</span></div><b id="spotDist${prefix}">60 ft</b></div>
    </div>
  `);
}

function operatorScene() {
  return `
    <div class="dashboard-demo">
      <div class="dash-header">
        <div><div class="eyebrow">Operator view</div><h2>Every lot. One dashboard.</h2><p>Real-time occupancy. Historical trends. Revenue at a glance.</p></div>
        <div class="dash-live"><div class="dot"></div>LIVE - UPDATED 0.4s AGO</div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><span>Revenue today</span><strong>$8,200</strong><em>Up 12%</em></div>
        <div class="kpi"><span>Occupancy</span><strong>72%</strong><em>Up 4%</em></div>
        <div class="kpi"><span>Cars today</span><strong>1,800</strong><em>Up 218</em></div>
        <div class="kpi"><span>Avg stay</span><strong>2.4h</strong><em>Down 0.2h</em></div>
      </div>
      <div class="bars-chart" id="barsChart">${[15, 22, 38, 52, 61, 68, 74, 82, 78, 65, 58, 72, 88, 92, 85].map((h) => `<div><span style="height:${h}%"></span></div>`).join('')}</div>
      <button class="demo-launch" type="button" data-launch-platform>Launch Sightline</button>
    </div>
  `;
}

function registerForm() {
  return `
    <form class="form" data-form="register">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" name="name" value="Avery Morgan" autocomplete="name" required>
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="text" inputmode="email" value="ops@example.com" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" value="parking123" autocomplete="new-password" required>
      </div>
      <div class="field">
        <label>Account type</label>
        <div class="role-grid">
          <label class="choice">
            <span class="choice-copy"><strong>Provider</strong><span>Operate facilities and cameras</span></span>
            <input type="radio" name="role" value="provider" checked>
          </label>
          <label class="choice">
            <span class="choice-copy"><strong>Driver</strong><span>Use guidance and availability</span></span>
            <input type="radio" name="role" value="driver">
          </label>
        </div>
      </div>
      <div class="field">
        <label for="organizationName">Workspace name</label>
        <input id="organizationName" name="organizationName" value="Crown City Parking Group" required>
      </div>
      <div class="field">
        <label for="providerType">Provider type</label>
        <select id="providerType" name="providerType">
          <option>Commercial Parking Company</option>
          <option>University</option>
          <option>Apartment Complex</option>
          <option>Office Building</option>
          <option>Event Venue</option>
          <option>Municipal Government</option>
          <option>Hospital</option>
          <option>Private Business</option>
        </select>
      </div>
      <button class="button full" type="submit">Create account</button>
    </form>
  `;
}

function loginForm() {
  return `
    <form class="form" data-form="login">
      <div class="field">
        <label for="loginEmail">Email</label>
        <input id="loginEmail" name="email" type="text" inputmode="email" value="ops@example.com" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="loginPassword">Password</label>
        <input id="loginPassword" name="password" type="password" value="parking123" autocomplete="current-password" required>
      </div>
      <button class="button full" type="submit">Log in</button>
    </form>
  `;
}
