const statusDot = document.getElementById('statusDot');
const hostInfo = document.getElementById('hostInfo');

const cpuHistory = [];
const memHistory = [];
const tempHistory = [];
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

function drawChart(canvas, values, opts = {}) {
  const { min, max, color = '#4f8cff', fillColor = 'rgba(79,140,255,0.15)', slots = values.length } = opts;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || 60;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const valid = values.filter((v) => v != null);
  if (valid.length < 2 || slots < 2) return;

  let lo = min;
  let hi = max;
  if (lo == null || hi == null) {
    lo = Math.min(...valid);
    hi = Math.max(...valid);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.1;
    lo -= pad;
    hi += pad;
  }

  const stepX = w / (slots - 1);
  const offset = slots - values.length;

  ctx.beginPath();
  let started = false;
  let lastX = null;
  values.forEach((val, i) => {
    const x = (offset + i) * stepX;
    if (val == null) {
      started = false;
      return;
    }
    const y = h - ((val - lo) / (hi - lo)) * h;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    lastX = x;
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (lastX != null) {
    const firstX = offset * stepX + values.findIndex((v) => v != null) * stepX;
    ctx.lineTo(lastX, h);
    ctx.lineTo(firstX, h);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
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
  drawChart(document.getElementById('cpuChart'), cpuHistory, { min: 0, max: 100, slots: HISTORY_LEN });

  pushHistory(tempHistory, stats.cpu.temperature);
  drawChart(document.getElementById('tempChart'), tempHistory, {
    slots: HISTORY_LEN,
    color: '#e8b339',
    fillColor: 'rgba(232,179,57,0.15)',
  });

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
  drawChart(document.getElementById('memChart'), memHistory, { min: 0, max: 100, slots: HISTORY_LEN });

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

  lastStats = stats;
  renderProcessTable();
}

// ----- Bang tien trinh: chon sap xep theo CPU hoac RAM -----

let lastStats = null;
let processSort = 'cpu';

function renderProcessTable() {
  if (!lastStats) return;
  const list = processSort === 'mem' ? lastStats.topProcessesByMem : lastStats.topProcessesByCpu;
  document.getElementById('procTitle').textContent =
    processSort === 'mem' ? 'Tiến trình dùng RAM nhiều nhất' : 'Tiến trình dùng CPU nhiều nhất';

  const procBody = document.getElementById('procBody');
  procBody.innerHTML = '';
  list.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.pid}</td><td>${p.name}</td><td>${p.cpu}%</td><td>${p.mem}%</td>`;
    procBody.appendChild(tr);
  });
}

document.querySelectorAll('.proc-sort-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    processSort = btn.dataset.sort;
    document.querySelectorAll('.proc-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderProcessTable();
  });
});

// ----- Tab Lich su -----

let currentRange = 'hour';
let historyTabVisible = false;

const RANGE_LABEL_FMT = {
  hour: (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
  day: (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
  month: (t) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
  year: (t) => new Date(t).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' }),
};

function renderLabels(el, points, range) {
  el.innerHTML = '';
  if (!points.length) return;
  const fmt = RANGE_LABEL_FMT[range];
  const idxs = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  [...new Set(idxs)].forEach((i) => {
    const span = document.createElement('span');
    span.textContent = fmt(points[i].t);
    el.appendChild(span);
  });
}

async function loadHistory(range) {
  currentRange = range;
  document.querySelectorAll('#tab-history .range-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  let points = [];
  try {
    const res = await fetch(`/api/history?range=${range}`);
    points = await res.json();
  } catch (e) {
    console.error('Khong tai duoc lich su', e);
    return;
  }

  const cpuVals = points.map((p) => p.cpu);
  const memVals = points.map((p) => p.mem);
  const tempVals = points.map((p) => p.temp);

  drawChart(document.getElementById('histCpuChart'), cpuVals, { min: 0, max: 100 });
  drawChart(document.getElementById('histMemChart'), memVals, { min: 0, max: 100 });
  drawChart(document.getElementById('histTempChart'), tempVals, {
    color: '#e8b339',
    fillColor: 'rgba(232,179,57,0.15)',
  });

  renderLabels(document.getElementById('histCpuLabels'), points, range);
  renderLabels(document.getElementById('histMemLabels'), points, range);
  renderLabels(document.getElementById('histTempLabels'), points, range);

  if (!points.length) {
    ['histCpuLabels', 'histMemLabels', 'histTempLabels'].forEach((id) => {
      document.getElementById(id).innerHTML = '<span>Chưa có dữ liệu cho khoảng thời gian này</span>';
    });
  }
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-live').hidden = tab !== 'live';
    document.getElementById('tab-history').hidden = tab !== 'history';
    historyTabVisible = tab === 'history';
    if (historyTabVisible) loadHistory(currentRange);
  });
});

document.querySelectorAll('#tab-history .range-btn').forEach((btn) => {
  btn.addEventListener('click', () => loadHistory(btn.dataset.range));
});

setInterval(() => {
  if (historyTabVisible) loadHistory(currentRange);
}, 60000);

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
