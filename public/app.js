const COLORS = {
  blue: '#5b8cff',
  violet: '#a78bfa',
  amber: '#f5a524',
  green: '#3ecf8e',
  cyan: '#38bdf8',
  red: '#f5636f',
};

const CHART_BLUE = { color: COLORS.blue, fillFrom: 'rgba(91,140,255,0.30)', fillTo: 'rgba(91,140,255,0)' };
const CHART_VIOLET = { color: COLORS.violet, fillFrom: 'rgba(167,139,250,0.30)', fillTo: 'rgba(167,139,250,0)' };
const CHART_AMBER = { color: COLORS.amber, fillFrom: 'rgba(245,165,36,0.30)', fillTo: 'rgba(245,165,36,0)' };

const HISTORY_LEN = 60;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52;

const cpuHistory = [];
const memHistory = [];
const tempHistory = [];

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmtBytes(bytes) {
  if (bytes == null) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

const fmtRate = (bytesPerSec) => `${fmtBytes(bytesPerSec)}/s`;

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function levelOf(value, warn, bad) {
  if (value == null) return 'ok';
  if (value >= bad) return 'bad';
  if (value >= warn) return 'warn';
  return 'ok';
}

function levelColor(level, baseColor) {
  if (level === 'bad') return COLORS.red;
  if (level === 'warn') return COLORS.amber;
  return baseColor;
}

function setGauge(arcEl, percent, color) {
  const pct = clamp(percent || 0, 0, 100);
  arcEl.style.strokeDasharray = String(GAUGE_CIRCUMFERENCE);
  arcEl.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE * (1 - pct / 100));
  arcEl.style.stroke = color;
  arcEl.style.filter = `drop-shadow(0 0 6px ${color}59)`;
}

function setBadge(badgeEl, level, text) {
  badgeEl.className = `badge ${level}`;
  badgeEl.textContent = text;
}

// ---------- Charts ----------

function tracePath(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
}

function drawChart(canvas, values, opts = {}) {
  const {
    min,
    max,
    color = COLORS.blue,
    fillFrom = 'rgba(91,140,255,0.30)',
    fillTo = 'rgba(91,140,255,0)',
    slots = values.length,
    highlightIndex = null,
    grid = false,
    unit = '',
  } = opts;
  const pad = { l: 0, t: 3, r: 0, b: 0, ...(opts.pad || {}) };

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || 60;
  if (!w || slots < 2) return;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const valid = values.filter((v) => v != null);

  let lo = min;
  let hi = max;
  if (lo == null || hi == null) {
    if (!valid.length) return;
    lo = Math.min(...valid);
    hi = Math.max(...valid);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const room = (hi - lo) * 0.15;
    lo -= room;
    hi += room;
  }

  const left = pad.l;
  const top = pad.t;
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const stepX = cw / (slots - 1);
  const offset = slots - values.length;
  const yOf = (v) => top + ch - ((v - lo) / (hi - lo)) * ch;

  if (grid) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [hi, (hi + lo) / 2, lo].forEach((tick) => {
      const y = Math.round(yOf(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + cw, y);
      ctx.stroke();
      if (pad.l > 14) ctx.fillText(`${Math.round(tick)}${unit}`, left - 7, y);
    });
    ctx.restore();
  }

  if (valid.length < 2) return;

  const segments = [];
  let current = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: left + (offset + i) * stepX, y: yOf(v) });
  });
  if (current.length) segments.push(current);

  const gradient = ctx.createLinearGradient(0, top, 0, top + ch);
  gradient.addColorStop(0, fillFrom);
  gradient.addColorStop(1, fillTo);

  segments.forEach((pts) => {
    if (pts.length < 2) return;

    ctx.beginPath();
    tracePath(ctx, pts);
    ctx.lineTo(pts[pts.length - 1].x, top + ch);
    ctx.lineTo(pts[0].x, top + ch);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    tracePath(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  });

  if (highlightIndex != null && values[highlightIndex] != null) {
    const x = left + (offset + highlightIndex) * stepX;
    const y = yOf(values[highlightIndex]);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + ch);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0a0c12';
    ctx.stroke();
  }
}

function pushHistory(arr, val) {
  arr.push(val);
  if (arr.length > HISTORY_LEN) arr.shift();
}

// ---------- Live rendering ----------

function renderCpu(cpu) {
  const level = levelOf(cpu.loadOverall, 70, 88);
  $('cpuLoad').textContent = cpu.loadOverall.toFixed(1);
  setGauge($('cpuGauge'), cpu.loadOverall, levelColor(level, COLORS.blue));
  setBadge($('cpuBadge'), level, level === 'bad' ? 'Quá tải' : level === 'warn' ? 'Tải cao' : 'Bình thường');

  $('cpuBrand').textContent = `${cpu.brand} · ${cpu.cores} luồng`;
  $('cpuSpeed').textContent = cpu.speed ? `${cpu.speed} GHz` : '--';

  const coresEl = $('cpuCores');
  coresEl.innerHTML = '';
  cpu.loadPerCore.forEach((load, i) => {
    const bar = el('div', `core-bar ${levelOf(load, 70, 88)}`);
    bar.title = `Luồng ${i}: ${load}%`;
    const fill = el('span');
    fill.style.height = `${clamp(load, 0, 100)}%`;
    bar.appendChild(fill);
    coresEl.appendChild(bar);
  });

  pushHistory(cpuHistory, cpu.loadOverall);
  drawChart($('cpuChart'), cpuHistory, { ...CHART_BLUE, min: 0, max: 100, slots: HISTORY_LEN });
}

function renderTemperature(cpu) {
  const temp = cpu.temperature;
  const level = levelOf(temp, 75, 88);

  $('cpuTemp').textContent = temp != null ? temp.toFixed(1) : '--';
  $('tempMax').textContent = cpu.temperatureMax != null ? `${cpu.temperatureMax.toFixed(1)} °C` : '--';
  setGauge($('tempGauge'), temp != null ? temp : 0, temp == null ? 'rgba(255,255,255,0.12)' : levelColor(level, COLORS.cyan));

  if (temp == null) {
    setBadge($('tempBadge'), 'ok', 'Không có cảm biến');
  } else {
    setBadge($('tempBadge'), level, level === 'bad' ? 'Nóng' : level === 'warn' ? 'Ấm' : 'Mát');
  }

  pushHistory(tempHistory, temp);
  drawChart($('tempChart'), tempHistory, { ...CHART_AMBER, slots: HISTORY_LEN });
}

function renderMemory(memory) {
  const level = levelOf(memory.usedPercent, 75, 90);
  $('memPercent').textContent = memory.usedPercent.toFixed(1);
  setGauge($('memGauge'), memory.usedPercent, levelColor(level, COLORS.violet));
  setBadge($('memBadge'), level, level === 'bad' ? 'Gần hết' : level === 'warn' ? 'Sắp đầy' : 'Bình thường');

  $('memUsed').textContent = fmtBytes(memory.used);
  $('memFree').textContent = fmtBytes(memory.free);
  $('memTotal').textContent = fmtBytes(memory.total);
  $('swapUsed').textContent = `${fmtBytes(memory.swapUsed)} / ${fmtBytes(memory.swapTotal)}`;

  const swapPct = memory.swapTotal ? (memory.swapUsed / memory.swapTotal) * 100 : 0;
  const swapBar = $('swapBar');
  swapBar.style.width = `${clamp(swapPct, 0, 100)}%`;
  swapBar.className = `track-fill ${levelOf(swapPct, 60, 85) === 'ok' ? 'violet' : levelOf(swapPct, 60, 85)}`;

  pushHistory(memHistory, memory.usedPercent);
  drawChart($('memChart'), memHistory, { ...CHART_VIOLET, min: 0, max: 100, slots: HISTORY_LEN });
}

function renderDisks(disks) {
  const wrap = $('disks');
  wrap.innerHTML = '';
  disks.forEach((d) => {
    const level = levelOf(d.usePercent, 75, 90);
    const item = el('div', 'disk-item');

    const label = el('div', 'label');
    label.appendChild(el('span', 'disk-mount', d.mount));

    const right = el('span');
    right.appendChild(el('span', 'disk-detail', `${fmtBytes(d.used)} / ${fmtBytes(d.size)}`));
    right.appendChild(document.createTextNode(' · '));
    right.appendChild(el('span', `disk-pct ${level}`, `${d.usePercent}%`));
    label.appendChild(right);

    const track = el('div', 'track');
    const fill = el('div', `track-fill ${level === 'ok' ? '' : level}`);
    fill.style.width = `${clamp(d.usePercent, 0, 100)}%`;
    track.appendChild(fill);

    item.append(label, track);
    wrap.appendChild(item);
  });
}

function renderNetwork(network) {
  const wrap = $('network');
  wrap.innerHTML = '';
  network.forEach((n) => {
    const item = el('div', 'net-item');
    item.appendChild(el('span', 'net-iface', n.iface));

    const rates = el('span', 'net-rates');
    const down = el('span', 'net-rate down', '↓ ');
    down.appendChild(el('span', null, fmtRate(n.rxSec)));
    const up = el('span', 'net-rate up', '↑ ');
    up.appendChild(el('span', null, fmtRate(n.txSec)));

    rates.append(down, up);
    item.appendChild(rates);
    wrap.appendChild(item);
  });
}

function render(stats) {
  $('lastUpdate').textContent = new Date(stats.timestamp).toLocaleTimeString('vi-VN');
  $('uptime').textContent = fmtUptime(stats.uptimeSec);

  renderCpu(stats.cpu);
  renderTemperature(stats.cpu);
  renderMemory(stats.memory);
  renderDisks(stats.disks);
  renderNetwork(stats.network);
}

// ---------- Tab Lich su ----------

let currentRange = 'hour';
let historyTabVisible = false;

const RANGE_HINT = {
  hour: '60 phút gần nhất · mỗi điểm là trung bình 1 phút',
  day: '24 giờ gần nhất · mỗi điểm là trung bình 1 giờ',
  month: '30 ngày gần nhất · mỗi điểm là trung bình 1 ngày',
  year: '12 tháng gần nhất · mỗi điểm là trung bình 1 tháng',
};

const RANGE_LABEL_FMT = {
  hour: (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
  day: (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
  month: (t) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
  year: (t) => new Date(t).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' }),
};

const TOOLTIP_TIME_FMT = {
  hour: (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
  day: (t) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
  month: (t) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  year: (t) => new Date(t).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }),
};

const HIST_PAD = { l: 40, t: 12, r: 10, b: 8 };
const chartTooltip = $('chartTooltip');

function hideChartTooltip() {
  chartTooltip.hidden = true;
}

function renderLabels(target, points, range) {
  target.innerHTML = '';
  if (!points.length) {
    target.appendChild(el('span', null, 'Chưa có dữ liệu cho khoảng thời gian này'));
    return;
  }
  const fmt = RANGE_LABEL_FMT[range];
  const idxs = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  idxs.forEach((i) => target.appendChild(el('span', null, fmt(points[i].t))));
}

function renderStats(target, values, unit) {
  const valid = values.filter((v) => v != null);
  if (!valid.length) {
    target.textContent = '';
    return;
  }
  const last = valid[valid.length - 1];
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;

  target.innerHTML = '';
  const parts = [
    ['Hiện tại', last],
    ['TB', avg],
    ['Thấp nhất', min],
    ['Cao nhất', max],
  ];
  parts.forEach(([label, value], i) => {
    if (i > 0) target.appendChild(document.createTextNode(' · '));
    target.appendChild(document.createTextNode(`${label}:`));
    target.appendChild(el('b', null, `${value.toFixed(1)}${unit}`));
  });
}

function bindChartHover(canvas, unit) {
  if (canvas._hoverBound) return;
  canvas._hoverBound = true;

  canvas.addEventListener('mousemove', (e) => {
    const values = canvas._histValues;
    const points = canvas._histPoints;
    if (!values || !points || points.length < 1) return;

    const rect = canvas.getBoundingClientRect();
    const pad = canvas._histOpts.pad || { l: 0, r: 0 };
    const chartW = rect.width - pad.l - pad.r;
    const ratio = (e.clientX - rect.left - pad.l) / chartW;
    const idx = clamp(Math.round(ratio * (values.length - 1)), 0, values.length - 1);

    drawChart(canvas, values, { ...canvas._histOpts, highlightIndex: idx });

    const value = values[idx];
    chartTooltip.innerHTML = '';
    chartTooltip.appendChild(el('div', 'tt-time', TOOLTIP_TIME_FMT[currentRange](points[idx].t)));
    chartTooltip.appendChild(
      el('div', 'tt-value', value != null ? `${value.toFixed(1)}${unit}` : 'Không có dữ liệu'),
    );
    chartTooltip.hidden = false;

    const ttRect = chartTooltip.getBoundingClientRect();
    let left = e.clientX + 14;
    let top = e.clientY - ttRect.height - 14;
    if (left + ttRect.width > window.innerWidth - 8) left = e.clientX - ttRect.width - 14;
    if (top < 8) top = e.clientY + 18;
    chartTooltip.style.left = `${left}px`;
    chartTooltip.style.top = `${top}px`;
  });

  canvas.addEventListener('mouseleave', () => {
    hideChartTooltip();
    if (canvas._histValues) drawChart(canvas, canvas._histValues, canvas._histOpts);
  });
}

function renderHistoryChart(canvas, points, key, unit, opts) {
  const values = points.map((p) => p[key]);
  drawChart(canvas, values, opts);
  canvas._histValues = values;
  canvas._histPoints = points;
  canvas._histOpts = opts;
  bindChartHover(canvas, unit);
}

async function loadHistory(range) {
  currentRange = range;
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });
  $('rangeHint').textContent = RANGE_HINT[range];

  let points = [];
  try {
    const res = await fetch(`/api/history?range=${range}`);
    points = await res.json();
  } catch (err) {
    console.error('Khong tai duoc lich su', err);
    return;
  }

  hideChartTooltip();

  renderHistoryChart($('histCpuChart'), points, 'cpu', '%', {
    ...CHART_BLUE,
    min: 0,
    max: 100,
    grid: true,
    unit: '%',
    pad: HIST_PAD,
  });
  renderHistoryChart($('histMemChart'), points, 'mem', '%', {
    ...CHART_VIOLET,
    min: 0,
    max: 100,
    grid: true,
    unit: '%',
    pad: HIST_PAD,
  });
  renderHistoryChart($('histTempChart'), points, 'temp', '°C', {
    ...CHART_AMBER,
    grid: true,
    unit: '°',
    pad: HIST_PAD,
  });

  renderStats($('histCpuStats'), points.map((p) => p.cpu), '%');
  renderStats($('histMemStats'), points.map((p) => p.mem), '%');
  renderStats($('histTempStats'), points.map((p) => p.temp), '°C');

  renderLabels($('histCpuLabels'), points, range);
  renderLabels($('histMemLabels'), points, range);
  renderLabels($('histTempLabels'), points, range);
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const tab = btn.dataset.tab;
    $('tab-live').hidden = tab !== 'live';
    $('tab-history').hidden = tab !== 'history';
    historyTabVisible = tab === 'history';
    if (historyTabVisible) loadHistory(currentRange);
  });
});

document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => loadHistory(btn.dataset.range));
});

setInterval(() => {
  if (historyTabVisible) loadHistory(currentRange);
}, 60000);

window.addEventListener('resize', () => {
  if (historyTabVisible) loadHistory(currentRange);
});

// ---------- WebSocket ----------

function setStatus(online) {
  const pill = $('statusPill');
  pill.classList.toggle('online', online);
  pill.classList.toggle('offline', !online);
  $('statusText').textContent = online ? 'Trực tuyến' : 'Mất kết nối';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setStatus(true);
    $('hostInfo').textContent = location.host;
  };

  ws.onmessage = (evt) => {
    try {
      render(JSON.parse(evt.data));
    } catch (err) {
      console.error('Du lieu khong hop le', err);
    }
  };

  ws.onclose = () => {
    setStatus(false);
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

connect();
