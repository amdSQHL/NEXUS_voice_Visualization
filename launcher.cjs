// Launch a local, hidden server and open the user's default browser.
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
function health(port) {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${port}/nexus-health`, { timeout: 500 }, response => {
      let body = ''; response.on('data', chunk => body += chunk);
      response.on('end', () => { try { resolve(JSON.parse(body).app === 'nexus-audio-visualizer'); } catch (_) { resolve(false); } });
    });
    request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}
function available(port) {
  return new Promise(resolve => {
    const probe = net.createServer(); probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}
function open(port) {
  const url = `http://127.0.0.1:${port}`;
  console.log(`NEXUS: ${url}`);
  if (process.env.NEXUS_NO_OPEN === '1') return;
  const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore', detached: true });
  browser.on('error', error => console.error(`Open the address above in your browser. ${error.message}`));
  browser.unref();
}
(async () => {
  for (let port = 4173; port < 4183; port++) {
    if (await health(port)) { open(port); return; }
    if (!await available(port)) continue;
    const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], {
      cwd: __dirname, env: { ...process.env, PORT: String(port) }, windowsHide: true, detached: true, stdio: 'ignore'
    });
    let failed = false; child.on('error', () => failed = true); child.unref();
    for (let attempt = 0; attempt < 16; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (await health(port)) { open(port); return; }
      if (failed) break;
    }
    try { child.kill(); } catch (_) { /* Process may already have exited. */ }
  }
  throw new Error('Could not start NEXUS on ports 4173-4182. Close an old local server and try again.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
