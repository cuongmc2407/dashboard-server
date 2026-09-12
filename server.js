const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const si = require('systeminformation');
const { WebSocketServer } = require('ws');
const history = require('./history');

// Tiny .env loader (khong can them dependency dotenv)
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const PORT = parseInt(process.env.PORT, 10) || 3334;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000;
const DASHBOARD_USER = process.env.DASHBOARD_USER || '';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || '';

const app = express();

if (DASHBOARD_USER && DASHBOARD_PASS) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (user === DASHBOARD_USER && pass === DASHBOARD_PASS) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Dashboard"');
    res.status(401).send('Authentication required');
  });
} else {
  console.warn('[canh bao] DASHBOARD_USER/DASHBOARD_PASS chua duoc dat trong .env - dashboard dang KHONG co mat khau. Neu se expose qua Cloudflare Tunnel, hay dat mat khau truoc.');
}

app.use(express.static(path.join(__dirname, 'public')));

async function collectStats() {
  const [cpuLoad, cpuTemp, mem, fsSize, netStats, time, cpu] = await Promise.all([
    si.currentLoad(),
    si.cpuTemperature().catch(() => ({ main: null, cores: [], max: null })),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.time(),
    si.cpu(),
  ]);

  return {
    timestamp: Date.now(),
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed,
      loadOverall: Number(cpuLoad.currentLoad.toFixed(1)),
      loadPerCore: cpuLoad.cpus.map((c) => Number(c.load.toFixed(1))),
      temperature: cpuTemp.main,
      temperatureMax: cpuTemp.max,
    },
    memory: {
      total: mem.total,
      used: mem.active,
      free: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
      usedPercent: mem.total ? Number(((mem.active / mem.total) * 100).toFixed(1)) : 0,
    },
    disks: fsSize.map((d) => ({
      fs: d.fs,
      mount: d.mount,
      size: d.size,
      used: d.used,
      usePercent: Number((d.use || 0).toFixed(1)),
    })),
    network: netStats.map((n) => ({
      iface: n.iface,
      rxSec: n.rx_sec || 0,
      txSec: n.tx_sec || 0,
    })),
    uptimeSec: time.uptime,
  };
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let latestStats = null;

async function pollLoop() {
  try {
    latestStats = await collectStats();
    history.recordSample(latestStats);
    const payload = JSON.stringify(latestStats);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
  } catch (err) {
    console.error('Loi khi thu thap so lieu:', err.message);
  } finally {
    setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}
history.init();
pollLoop();

wss.on('connection', (ws) => {
  if (latestStats) ws.send(JSON.stringify(latestStats));
});

app.get('/api/stats', async (req, res) => {
  res.json(latestStats || (await collectStats()));
});

app.get('/api/history', (req, res) => {
  const range = ['hour', 'day', 'month', 'year'].includes(req.query.range) ? req.query.range : 'hour';
  res.json(history.getRange(range));
});

server.listen(PORT, () => {
  console.log(`Dashboard dang chay tai http://localhost:${PORT}`);
});
