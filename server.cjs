// Optional localhost preview. The app also works directly from dist/index.html.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/nexus-health') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ app: 'nexus-audio-visualizer', version: '1.2.0' })); return;
    }
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    fs.readFile(target, (error, data) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); response.end(data);
    });
  } catch (_) { response.writeHead(400); response.end('Bad request'); }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log(`NEXUS: http://localhost:${server.address().port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port 4173 is occupied. Set PORT to another available port.' : error.message); process.exitCode = 1; });
