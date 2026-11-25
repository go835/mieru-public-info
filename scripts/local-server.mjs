import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('.');
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
  const filePath = resolve(root, normalize(relativePath));
  if (!filePath.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    if (statSync(filePath).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(filePath).pipe(response);
  } catch { response.writeHead(404).end(); }
}).listen(8788, () => console.log('みえるバス情報: http://localhost:8788'));
