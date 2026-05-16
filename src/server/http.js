import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.webm', 'video/webm'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.ico', 'image/x-icon']
]);

export function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export async function readJson(req) {
  const body = await readBody(req, 1024 * 1024);
  if (!body.length) return {};

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}

export async function readBody(req, maxBytes = 1024 * 1024 * 50) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Upload is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function parseContentDisposition(value) {
  return Object.fromEntries(
    String(value || '')
      .split(';')
      .slice(1)
      .map((part) => part.trim().match(/^([^=]+)="?([^"]*)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

export async function readMultipartForm(req, { maxBytes = 1024 * 1024 * 500 } = {}) {
  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
  if (!boundary) {
    const error = new Error('Multipart boundary is missing.');
    error.status = 400;
    throw error;
  }

  const body = await readBody(req, maxBytes);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};

  for (const rawPart of splitBuffer(body, delimiter)) {
    let part = rawPart;
    if (!part.length || part.equals(Buffer.from('--\r\n')) || part.equals(Buffer.from('--'))) continue;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(-2).toString() === '\r\n') part = part.subarray(0, -2);
    if (part.subarray(-2).toString() === '--') part = part.subarray(0, -2);

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerLines = part.subarray(0, headerEnd).toString('utf8').split('\r\n');
    const headers = Object.fromEntries(headerLines.map((line) => {
      const [name, ...rest] = line.split(':');
      return [name.trim().toLowerCase(), rest.join(':').trim()];
    }));
    const disposition = parseContentDisposition(headers['content-disposition']);
    const name = disposition.name;
    if (!name) continue;

    const content = part.subarray(headerEnd + 4);
    if (disposition.filename) {
      files[name] = {
        filename: path.basename(disposition.filename),
        contentType: headers['content-type'] || 'application/octet-stream',
        data: content
      };
    } else {
      fields[name] = content.toString('utf8');
    }
  }

  return { fields, files };
}

export function routeUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

export function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  return cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || null;
}

export function sessionCookie(token, maxAgeSeconds) {
  return [
    `iris_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ].join('; ');
}

export function clearSessionCookie() {
  return 'iris_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export async function serveStatic(req, res, publicDir) {
  const url = routeUrl(req);
  const requested = decodeURIComponent(url.pathname);
  const safePath = requested === '/' ? '/index.html' : requested;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const indexPath = path.join(publicDir, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    'content-type': MIME_TYPES.get(ext) || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  createReadStream(filePath).pipe(res);
}
