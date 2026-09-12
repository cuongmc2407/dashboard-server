const statusDot = document.getElementById('statusDot');
const hostInfo = document.getElementById('hostInfo');

const cpuHistory = [];
const memHistory = [];
const HISTORY_LEN = 60;

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function fmtRate(bytesPerSec) {
  return `${fmtBytes(bytesPerSec)}/s`;
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function drawSparkline(canvas, data, max) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || 60;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) return;

  const stepX = w / (HISTORY_LEN - 1);
  const offset = HISTORY_LEN - data.length;

  ctx.beginPath();
  data.forEach((val, i) => {
    const x = (offset + i) * stepX;
    const y = h - (val / max) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#4f8cff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo((offset + data.length - 1) * stepX, h);
  ctx.lineTo(offset * stepX, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(79,140,255,0.15)';
  ctx.fill();
}

function pushHistory(arr, val) {
  arr.push(val);
  if (arr.length > HISTORY_LEN) arr.shift();
}

function usageClass(percent) {
  if (percent >= 90) return 'bad';
  if (percent >= 70) return 'warn';
  return '';
}

function render(stats) {
  document.getElementById('lastUpdate').textContent = new Date(stats.timestamp).toLocaleTimeString('vi-VN');
  document.getElementById('uptime').textContent = fmtUptime(stats.uptimeSec);

  // CPU
  document.getElementById('cpuLoad').textContent = stats.cpu.loadOverall.toFixed(1);
  document.getElementById('cpuBrand').textContent = `${stats.cpu.brand} (${stats.cpu.cores} luồng)`;
  document.getElementById('cpuTemp').textContent = stats.cpu.temperature != null ? `${stats.cpu.temperature.toFixed(1)} °C` : 'N/A';

  pushHistory(cpuHistory, stats.cpu.loadOverall);
  drawSparkline(document.getElementById('cpuChart'), cpuHistory, 100);

  const coresEl = document.getElementById('cpuCores');
  coresEl.innerHTML = '';
  stats.cpu.loadPerCore.forEach((load, i) => {
    const bar = document.createElement('div');
    bar.className = 'core-bar';
    bar.title = `Core ${i}: ${load}%`;
    const fill = document.createElement('span');
    fill.style.height = `${load}%`;
    bar.appendChild(fill);
    coresEl.appendChild(bar);
  });

  // RAM
  document.getElementById('memPercent').textContent = stats.memory.usedPercent.toFixed(1);
  document.getElementById('memUsed').textContent = fmtBytes(stats.memory.used);
  document.getElementById('memTotal').textContent = fmtBytes(stats.memory.total);
  document.getElementById('swapUsed').textContent = `${fmtBytes(stats.memory.swapUsed)} / ${fmtBytes(stats.memory.swapTotal)}`;

  pushHistory(memHistory, stats.memory.usedPercent);
  drawSparkline(document.getElementById('memChart'), memHistory, 100);

  // Disks
  const disksEl = document.getElementById('disks');
  disksEl.innerHTML = '';
  stats.disks.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'disk-item';
    const cls = usageClass(d.usePercent);
    item.innerHTML = `
      <div class="label"><span>${d.mount}</span><span>${d.usePercent}% (${fmtBytes(d.used)} / ${fmtBytes(d.size)})</span></div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${d.usePercent}%"></div></div>
    `;
    disksEl.appendChild(item);
  });

  // Network
  const netEl = document.getElementById('network');
  netEl.innerHTML = '';
  stats.network.forEach((n) => {
    const item = document.createElement('div');
    item.className = 'net-item';
    item.innerHTML = `<span>${n.iface}</span><span>↓ ${fmtRate(n.rxSec)} · ↑ ${fmtRate(n.txSec)}</span>`;
    netEl.appendChild(item);
  });

  // Processes
  const procBody = document.getElementById('procBody');
  procBody.innerHTML = '';
  stats.topProcesses.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.pid}</td><td>${p.name}</td><td>${p.cpu}%</td><td>${p.mem}%</td>`;
    procBody.appendChild(tr);
  });
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
    hostInfo.textContent = location.host;
  };

  ws.onmessage = (evt) => {
    try {
      render(JSON.parse(evt.data));
    } catch (e) {
      console.error('Du lieu khong hop le', e);
    }
  };

  ws.onclose = () => {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

connect();
