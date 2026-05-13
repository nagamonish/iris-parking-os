import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.IRIS_DB_PATH || path.join(dataDir, 'iris.db');
const db = new DatabaseSync(dbPath);

export function nowIso() {
  return new Date().toISOString();
}

export function initializeDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('provider', 'driver')),
      organization_name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      address TEXT NOT NULL,
      levels INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      occupied INTEGER NOT NULL,
      cameras_online INTEGER NOT NULL,
      cameras_total INTEGER NOT NULL,
      confidence INTEGER NOT NULL,
      rules TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS camera_events (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_assignments (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      level INTEGER NOT NULL,
      zone TEXT NOT NULL,
      spot_label TEXT NOT NULL,
      eta TEXT NOT NULL,
      walk_distance TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      status_message TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function facilityOpenSpaces(facility) {
  return Math.max(0, Number(facility.capacity) - Number(facility.occupied));
}

function workspaceUser(user) {
  if (!user) return null;
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(email);
}

export function getUserById(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(userId);
}

export function createUser({ name, email, passwordHash, role, organizationName, providerType }) {
  const userId = id('user');
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, organization_name, provider_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    name,
    email,
    passwordHash,
    role,
    organizationName,
    providerType,
    nowIso()
  );
  return getUserById(userId);
}

export function seedWorkspace(userId, organizationName, providerType) {
  const createdAt = nowIso();
  const propertyId = id('property');
  db.prepare(`
    INSERT INTO properties (id, user_id, name, address, provider_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    propertyId,
    userId,
    organizationName || 'Crown City Parking Group',
    'Charlotte, NC',
    providerType || 'Commercial Parking Company',
    'Demo-safe workspace seeded for reliable local evaluation.',
    createdAt
  );

  const facilities = [
    {
      name: 'East Deck 1 Demo',
      type: 'Deck',
      address: 'Mary Alexander Rd, Charlotte, NC',
      levels: 5,
      capacity: 760,
      occupied: 213,
      camerasOnline: 2,
      camerasTotal: 2,
      confidence: 93,
      rules: 'Visitor entry on Level 1. Permit zones on levels 2-5.'
    },
    {
      name: 'CRI Deck 1 Demo',
      type: 'Deck',
      address: 'Robert D. Snyder Rd, Charlotte, NC',
      levels: 7,
      capacity: 1347,
      occupied: 916,
      camerasOnline: 3,
      camerasTotal: 3,
      confidence: 97,
      rules: 'Visitor, student, faculty, event, and EV rules by level.'
    },
    {
      name: 'Resident Garage',
      type: 'Garage',
      address: '2140 Hawkins St, Charlotte, NC',
      levels: 4,
      capacity: 312,
      occupied: 226,
      camerasOnline: 1,
      camerasTotal: 1,
      confidence: 94,
      rules: 'Resident permit, guest QR, and EV allocation.'
    }
  ];

  const insertFacility = db.prepare(`
    INSERT INTO facilities (
      id, property_id, name, type, address, levels, capacity, occupied,
      cameras_online, cameras_total, confidence, rules, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const firstFacilityId = id('facility');
  facilities.forEach((facility, index) => {
    insertFacility.run(
      index === 0 ? firstFacilityId : id('facility'),
      propertyId,
      facility.name,
      facility.type,
      facility.address,
      facility.levels,
      facility.capacity,
      facility.occupied,
      facility.camerasOnline,
      facility.camerasTotal,
      facility.confidence,
      facility.rules,
      createdAt
    );
  });

  db.prepare(`
    INSERT INTO driver_assignments (
      user_id, facility_id, level, zone, spot_label, eta, walk_distance,
      confidence, status_message, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    firstFacilityId,
    3,
    'B',
    'B-329',
    '1:35',
    '186 ft',
    93,
    'Open and camera-confirmed near the ramp exit.',
    createdAt
  );
}

export function getWorkspace(userId) {
  const user = getUserById(userId);
  const properties = db.prepare('SELECT * FROM properties WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const facilities = db.prepare(`
    SELECT facilities.*
    FROM facilities
    JOIN properties ON properties.id = facilities.property_id
    WHERE properties.user_id = ?
    ORDER BY facilities.updated_at DESC, facilities.name ASC
  `).all(userId);
  const events = db.prepare(`
    SELECT camera_events.*
    FROM camera_events
    JOIN facilities ON facilities.id = camera_events.facility_id
    JOIN properties ON properties.id = facilities.property_id
    WHERE properties.user_id = ?
    ORDER BY camera_events.created_at DESC
    LIMIT 8
  `).all(userId);
  const assignment = db.prepare(`
    SELECT driver_assignments.*, facilities.name AS facility_name
    FROM driver_assignments
    JOIN facilities ON facilities.id = driver_assignments.facility_id
    WHERE driver_assignments.user_id = ?
  `).get(userId);

  const totalCapacity = facilities.reduce((sum, facility) => sum + facility.capacity, 0);
  const occupied = facilities.reduce((sum, facility) => sum + facility.occupied, 0);
  const camerasOnline = facilities.reduce((sum, facility) => sum + facility.cameras_online, 0);
  const camerasTotal = facilities.reduce((sum, facility) => sum + facility.cameras_total, 0);
  const avgConfidence = facilities.length
    ? Math.round(facilities.reduce((sum, facility) => sum + facility.confidence, 0) / facilities.length)
    : 0;

  return {
    user: workspaceUser(user),
    metrics: {
      properties: properties.length,
      facilities: facilities.length,
      totalCapacity,
      occupied,
      openSpaces: Math.max(0, totalCapacity - occupied),
      occupancyRate: totalCapacity ? Math.round((occupied / totalCapacity) * 100) : 0,
      camerasOnline,
      camerasTotal,
      avgConfidence
    },
    properties: properties.map((property) => ({
      ...property,
      facilities: facilities
        .filter((facility) => facility.property_id === property.id)
        .map((facility) => ({
          ...facility,
          open_spaces: facilityOpenSpaces(facility),
          occupancy_rate: facility.capacity ? Math.round((facility.occupied / facility.capacity) * 100) : 0
        }))
    })),
    events,
    assignment
  };
}

export function addFacility(userId, body) {
  const property = db.prepare('SELECT * FROM properties WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(userId);
  if (!property) throw new Error('Workspace has no property');

  const capacity = Math.max(1, Number(body.capacity || 120));
  const occupied = Math.max(0, Math.min(capacity, Number(body.occupied || Math.round(capacity * 0.42))));

  db.prepare(`
    INSERT INTO facilities (
      id, property_id, name, type, address, levels, capacity, occupied,
      cameras_online, cameras_total, confidence, rules, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id('facility'),
    property.id,
    String(body.name || 'New parking facility').trim(),
    String(body.type || 'Garage').trim(),
    String(body.address || property.address).trim(),
    Math.max(1, Number(body.levels || 1)),
    capacity,
    occupied,
    Math.max(0, Number(body.camerasOnline || 1)),
    Math.max(1, Number(body.camerasTotal || 1)),
    Math.max(75, Math.min(99, Number(body.confidence || 92))),
    String(body.rules || 'Provider-defined access and validation rules.').trim(),
    nowIso()
  );
}

export function runCameraScan(userId) {
  const facilities = db.prepare(`
    SELECT facilities.*
    FROM facilities
    JOIN properties ON properties.id = facilities.property_id
    WHERE properties.user_id = ?
  `).all(userId);

  const updateFacility = db.prepare(`
    UPDATE facilities
    SET occupied = ?, confidence = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertEvent = db.prepare(`
    INSERT INTO camera_events (id, facility_id, event_type, message, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  facilities.forEach((facility, index) => {
    const drift = ((Date.now() / 1000 + index * 7) % 11) - 5;
    const occupied = Math.max(0, Math.min(facility.capacity, facility.occupied + Math.round(drift)));
    const confidence = Math.max(88, Math.min(99, facility.confidence + (index % 2 === 0 ? 1 : -1)));
    const timestamp = nowIso();
    updateFacility.run(occupied, confidence, timestamp, facility.id);
    insertEvent.run(
      id('event'),
      facility.id,
      drift >= 0 ? 'vehicle_entered' : 'space_opened',
      `${facility.name}: camera scan reconciled ${Math.abs(Math.round(drift)) || 1} stall changes.`,
      confidence,
      timestamp
    );
  });
}

export function reassignDriver(userId) {
  const facilities = db.prepare(`
    SELECT facilities.*
    FROM facilities
    JOIN properties ON properties.id = facilities.property_id
    WHERE properties.user_id = ?
    ORDER BY (capacity - occupied) DESC
    LIMIT 1
  `).all(userId);
  const facility = facilities[0];
  if (!facility) throw new Error('No facility available');

  const spotNumber = 300 + Math.floor(Math.random() * 48);
  const confidence = Math.max(88, Math.min(99, facility.confidence));
  db.prepare(`
    UPDATE driver_assignments
    SET facility_id = ?, level = ?, zone = ?, spot_label = ?, eta = ?, walk_distance = ?,
        confidence = ?, status_message = ?, updated_at = ?
    WHERE user_id = ?
  `).run(
    facility.id,
    Math.min(3, facility.levels),
    'B',
    `B-${spotNumber}`,
    '1:20',
    '172 ft',
    confidence,
    `${facility.name} has the best open inventory. IRIS reserved a camera-confirmed spot near the ramp path.`,
    nowIso(),
    userId
  );
}

export default db;
