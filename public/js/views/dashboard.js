import { brand, escapeHtml, formatNumber, icon, metric, pill, themeToggle } from '../components.js';

const navItems = [
  ['overview', 'Overview', 'grid'],
  ['facilities', 'Facilities', 'plus'],
  ['detection', 'Camera detection', 'camera'],
  ['driver', 'Driver app sync', 'route'],
  ['account', 'Account', 'shield']
];

export function renderShell(state) {
  const workspace = state.workspace;
  const user = workspace.user;
  const view = state.view || 'overview';
  return `
    <main class="shell">
      <aside class="sidebar">
        ${brand()}
        <div class="side-card"><span>Console</span><strong>Operator web</strong></div>
        <div class="side-card"><span>Workspace</span><strong>${escapeHtml(user.organization_name)}</strong></div>
        <div class="side-card"><span>Stored in</span><strong>SQLite database</strong></div>
        <nav class="nav" aria-label="Primary navigation">
          ${navItems.map(([id, label, iconName]) => `
            <button class="${view === id ? 'active' : ''}" data-view="${id}" aria-label="${label}" title="${label}">
              ${icon(iconName)}
              <span>${label}</span>
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          ${themeToggle(state.theme)}
          <button class="button secondary full" data-action="refresh">Refresh data</button>
          <button class="button danger full" data-action="logout">${icon('logout')} Log out</button>
        </div>
      </aside>
      <section class="main">
        ${renderTopbar(state)}
        ${renderView(state)}
      </section>
    </main>
  `;
}

function renderTopbar(state) {
  const titles = {
    overview: ['Operator command center', 'Reliable portfolio visibility, live inventory, and persisted workspace data.'],
    facilities: ['Facilities', 'Add and review facilities stored in SQLite.'],
    detection: ['Camera detection', 'Replay local footage and persist live test events against facilities.'],
    driver: ['Driver app sync', 'Monitor camera-confirmed guidance sent to the Sightline mobile app.'],
    account: ['Account and persistence', 'User profile, session, and database status.']
  };
  const [title, subtitle] = titles[state.view] || titles.overview;
  const action = state.view === 'detection'
    ? `<button class="button" data-action="scan">${icon('scan')} Run scan</button>`
    : state.view === 'driver'
      ? `<button class="button" data-action="reassign">${icon('route')} Sync mobile assignment</button>`
      : '';

  return `
    <header class="topbar">
      <div>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      ${action}
    </header>
  `;
}

function renderView(state) {
  if (state.view === 'facilities') return renderFacilities(state);
  if (state.view === 'detection') return renderDetection(state);
  if (state.view === 'driver') return renderDriver(state);
  if (state.view === 'account') return renderAccount(state);
  return renderOverview(state);
}

function renderOverview(state) {
  const { workspace } = state;
  return `
    <section class="grid">
      <div class="grid metrics">
        ${metric('Open spaces', formatNumber(workspace.metrics.openSpaces), `${workspace.metrics.occupancyRate}% occupied`)}
        ${metric('Facilities', formatNumber(workspace.metrics.facilities), `${workspace.metrics.properties} propert${workspace.metrics.properties === 1 ? 'y' : 'ies'}`)}
        ${metric('Cameras online', `${workspace.metrics.camerasOnline}/${workspace.metrics.camerasTotal}`, `${workspace.metrics.avgConfidence}% confidence`)}
        ${metric('Database', 'Active', 'SQLite persistence')}
      </div>
      <div class="grid content-grid">
        <section class="panel">
          <h3>Facilities at a glance</h3>
          <div class="facility-list">${facilityCards(workspace)}</div>
        </section>
        <section class="panel">
          <h3>Recent camera events</h3>
          ${eventList(workspace)}
        </section>
      </div>
    </section>
  `;
}

function renderFacilities(state) {
  const { workspace } = state;
  return `
    <section class="grid content-grid">
      <div class="panel">
        <h3>Stored facilities</h3>
        <div class="facility-list">${facilityCards(workspace)}</div>
      </div>
      <form class="form-panel form" data-form="facility">
        <h3>Add facility</h3>
        <div class="field"><label for="facilityName">Name</label><input id="facilityName" name="name" value="Uptown Visitor Garage" required></div>
        <div class="field"><label for="facilityType">Type</label><select id="facilityType" name="type"><option>Garage</option><option>Deck</option><option>Surface Lot</option></select></div>
        <div class="field"><label for="facilityAddress">Address</label><input id="facilityAddress" name="address" value="201 S Tryon St, Charlotte, NC"></div>
        <div class="field"><label for="facilityCapacity">Capacity</label><input id="facilityCapacity" name="capacity" type="text" inputmode="numeric" value="420"></div>
        <div class="field"><label for="facilityOccupied">Occupied</label><input id="facilityOccupied" name="occupied" type="text" inputmode="numeric" value="176"></div>
        <div class="field"><label for="facilityLevels">Levels</label><input id="facilityLevels" name="levels" type="text" inputmode="numeric" value="5"></div>
        <div class="field"><label for="facilityRules">Rules</label><textarea id="facilityRules" name="rules">Visitor validation, monthly permits, and event-mode overrides.</textarea></div>
        <button class="button" type="submit">${icon('plus')} Save facility</button>
      </form>
    </section>
  `;
}

function renderDetection(state) {
  const { workspace } = state;
  const facilities = allFacilities(workspace);
  const calibration = escapeHtml(JSON.stringify(defaultVisionCalibration(), null, 2));
  return `
    <section class="grid detection-grid">
      <div class="panel">
        <h3>Camera-to-space map</h3>
        <table class="table">
          <thead><tr><th>Facility</th><th>Spaces</th><th>Cameras</th><th>Confidence</th></tr></thead>
          <tbody data-camera-map-body>${cameraMapRows(workspace)}</tbody>
        </table>
      </div>
      <div class="panel vision-panel">
        <h3>Real-world CV detector</h3>
        <p class="panel-copy">Upload parking-lot footage and run the local YOLO/OpenCV detector. The template JSON is only a starting point; replace it with this camera's actual stall and lane polygons before scoring spaces.</p>
        <div class="video-controls-grid">
          <div class="field">
            <label for="visionFacility">Facility</label>
            <select id="visionFacility" data-vision-facility>
              ${facilities.map((facility) => `<option value="${escapeHtml(facility.id)}">${escapeHtml(facility.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="visionConfidence">Vehicle confidence</label>
            <input id="visionConfidence" data-vision-confidence type="text" inputmode="decimal" value="0.55">
          </div>
          <div class="field">
            <label for="visionModel">Detection model</label>
            <select id="visionModel" data-vision-model>
              <option value="auto">Auto: OBB then v8</option>
              <option value="yolo26m-obb.pt">26m OBB</option>
              <option value="yolo26s-obb.pt">26s OBB</option>
              <option value="yolov8n.pt">v8n boxes</option>
              <option value="none">Motion fallback</option>
            </select>
          </div>
          <div class="field">
            <label for="visionSampleRate">Sample rate</label>
            <input id="visionSampleRate" data-vision-sample-rate type="text" inputmode="decimal" value="4">
          </div>
        </div>
        <label class="video-drop" data-vision-drop>
          <span>Drop real footage here or choose MP4, MOV, or WebM</span>
          <input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv" data-vision-input>
        </label>
        <label class="video-drop truth-drop" data-truth-drop>
          <span>Optional: drop ground-truth JSON or CSV to score accuracy</span>
          <input type="file" accept="application/json,text/csv,.json,.csv" data-truth-input>
        </label>
        <div class="field">
          <label for="visionCalibration">Camera calibration JSON</label>
          <textarea id="visionCalibration" class="calibration-input" data-vision-calibration>${calibration}</textarea>
        </div>
        <div class="video-actions">
          <button class="button" type="button" data-action="vision-start">${icon('scan')} Start CV analysis</button>
          <button class="button secondary" type="button" data-action="vision-stop">Stop</button>
        </div>
        <div class="video-status" data-vision-status>Waiting for real footage.</div>
        <div class="vision-output" data-vision-output></div>
      </div>
      <div class="panel">
        <h3>Event log</h3>
        <div data-event-log>${eventList(workspace)}</div>
      </div>
      <div class="panel video-test-panel">
        <h3>Motion smoke test</h3>
        <p class="panel-copy">Use this lightweight browser-only tester for quick plumbing checks. Real camera validation should use the CV detector above.</p>
        <div class="video-controls-grid">
          <div class="field">
            <label for="videoFacility">Facility</label>
            <select id="videoFacility" data-video-facility>
              ${facilities.map((facility) => `<option value="${escapeHtml(facility.id)}">${escapeHtml(facility.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="videoEventMode">Event output</label>
            <select id="videoEventMode" data-video-event-mode>
              <option value="auto">Auto cycle</option>
              <option value="vehicle_entered">Vehicle entered</option>
              <option value="space_opened">Space opened</option>
              <option value="motion_detected">Motion only</option>
            </select>
          </div>
          <div class="field">
            <label for="videoThreshold">Motion threshold</label>
            <input id="videoThreshold" data-video-threshold type="text" inputmode="numeric" value="18">
          </div>
        </div>
        <label class="video-drop" data-video-drop>
          <span>Drop simple footage here or choose MP4, MOV, or WebM</span>
          <input type="file" accept="video/*" data-video-input>
        </label>
        <video class="feed-video" data-video-preview controls muted playsinline></video>
        <div class="video-actions">
          <button class="button" type="button" data-action="video-test-start">${icon('scan')} Start live test</button>
          <button class="button secondary" type="button" data-action="video-test-stop">Stop</button>
        </div>
        <div class="video-status" data-video-status>Waiting for footage.</div>
      </div>
    </section>
  `;
}

function renderDriver(state) {
  const assignment = state.workspace.assignment;
  if (!assignment) return '<div class="empty">No mobile app assignment has been created yet.</div>';
  return `
    <section class="grid content-grid">
      <article class="assignment-card">
        <span>Mobile app assignment</span>
        <h3>Level ${assignment.level} · Zone ${escapeHtml(assignment.zone)} · ${escapeHtml(assignment.spot_label)}</h3>
        <p>${escapeHtml(assignment.status_message)}</p>
        <div class="assignment-meta">
          ${pill('Open', true)}
          ${pill('Camera confirmed', true)}
          ${pill(`${assignment.confidence}% confidence`)}
          ${pill(`${escapeHtml(assignment.walk_distance)} walk`)}
          ${pill(`ETA ${escapeHtml(assignment.eta)}`)}
        </div>
      </article>
      <div class="panel">
        <h3>Operator context</h3>
        <div class="facility-list">
          ${facilityCards(state.workspace)}
        </div>
      </div>
    </section>
  `;
}

function renderAccount(state) {
  const user = state.workspace.user;
  return `
    <section class="grid content-grid">
      <div class="panel">
        <h3>Profile</h3>
        <table class="table">
          <tbody>
            <tr><th>Name</th><td>${escapeHtml(user.name)}</td></tr>
            <tr><th>Email</th><td>${escapeHtml(user.email)}</td></tr>
            <tr><th>Web access</th><td>Operator console</td></tr>
            <tr><th>Workspace</th><td>${escapeHtml(user.organization_name)}</td></tr>
            <tr><th>Operator type</th><td>${escapeHtml(user.provider_type)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="panel">
        <h3>Reliability model</h3>
        <div class="event-list">
          <div class="event-row"><strong>SQLite database</strong><span>Operator accounts, sessions, properties, facilities, camera events, and mobile assignments are persisted.</span></div>
          <div class="event-row"><strong>Cookie sessions</strong><span>Authentication state survives refreshes and browser restarts until expiry or logout.</span></div>
          <div class="event-row"><strong>Driver app boundary</strong><span>Driver registration and onboarding belong in the Sightline mobile application, not the operator website.</span></div>
          <div class="event-row"><strong>Local-first demo</strong><span>No third-party service is needed to run or test the core product.</span></div>
        </div>
      </div>
    </section>
  `;
}

function allFacilities(workspace) {
  return workspace.properties.flatMap((property) => property.facilities);
}

function defaultVisionCalibration() {
  return {
    spaces: [
      { id: 'P1', points: [[0.15, 0.24], [0.255, 0.24], [0.255, 0.43], [0.15, 0.43]] },
      { id: 'P2', points: [[0.29, 0.24], [0.395, 0.24], [0.395, 0.43], [0.29, 0.43]] },
      { id: 'P3', points: [[0.43, 0.24], [0.535, 0.24], [0.535, 0.43], [0.43, 0.43]] },
      { id: 'P4', points: [[0.57, 0.24], [0.675, 0.24], [0.675, 0.43], [0.57, 0.43]] },
      { id: 'P5', points: [[0.71, 0.24], [0.815, 0.24], [0.815, 0.43], [0.71, 0.43]] },
      { id: 'P6', points: [[0.15, 0.54], [0.255, 0.54], [0.255, 0.73], [0.15, 0.73]] },
      { id: 'P7', points: [[0.29, 0.54], [0.395, 0.54], [0.395, 0.73], [0.29, 0.73]] },
      { id: 'P8', points: [[0.43, 0.54], [0.535, 0.54], [0.535, 0.73], [0.43, 0.73]] },
      { id: 'P9', points: [[0.57, 0.54], [0.675, 0.54], [0.675, 0.73], [0.57, 0.73]] },
      { id: 'P10', points: [[0.71, 0.54], [0.815, 0.54], [0.815, 0.73], [0.71, 0.73]] }
    ],
    lanes: [
      { id: 'main_lane', points: [[0.04, 0.72], [0.96, 0.72], [0.96, 0.92], [0.04, 0.92]] }
    ]
  };
}

function cameraMapRows(workspace) {
  return allFacilities(workspace).map((facility) => `
    <tr>
      <td><strong>${escapeHtml(facility.name)}</strong><br><span>${escapeHtml(facility.type)}</span></td>
      <td>${formatNumber(facility.open_spaces)} open</td>
      <td>${facility.cameras_online}/${facility.cameras_total}</td>
      <td>${facility.confidence}%</td>
    </tr>
  `).join('');
}

function facilityCards(workspace) {
  const facilities = allFacilities(workspace);
  if (!facilities.length) return '<div class="empty">No facilities yet.</div>';
  return facilities.map((facility) => `
    <article class="facility-card">
      <div class="facility-head">
        <div>
          <strong>${escapeHtml(facility.name)}</strong>
          <p>${escapeHtml(facility.address)}</p>
        </div>
        ${pill(`${facility.occupancy_rate}% occupied`)}
      </div>
      <div class="progress" aria-hidden="true"><span style="--value: ${facility.occupancy_rate}%"></span></div>
      <div class="facility-meta">
        ${pill(`${formatNumber(facility.open_spaces)} open`, true)}
        ${pill(`${facility.cameras_online}/${facility.cameras_total} cameras`)}
        ${pill(`${facility.confidence}% confidence`)}
      </div>
    </article>
  `).join('');
}

function eventList(workspace) {
  if (!workspace.events.length) return '<div class="empty">Run a camera scan to create persisted events.</div>';
  return `
    <div class="event-list">
      ${workspace.events.map((event) => `
        <div class="event-row">
          <strong>${escapeHtml(event.event_type.replaceAll('_', ' '))}</strong>
          <span>${escapeHtml(event.message)} · ${event.confidence}% · ${new Date(event.created_at).toLocaleString()}</span>
        </div>
      `).join('')}
    </div>
  `;
}
