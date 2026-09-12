const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'history.json');

const LIMITS = {
  minute: 24 * 60, // 24h o do phan giai phut
  hour: 24 * 7, // 7 ngay o do phan giai gio
  day: 400, // ~13 thang o do phan giai ngay
  month: 60, // 5 nam o do phan giai thang
};

let points = { minute: [], hour: [], day: [], month: [] };
let currentMinuteSamples = [];

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      points = { ...points, ...raw };
    }
  } catch (err) {
    console.error('Khong doc duoc history.json, bat dau tu dau:', err.message);
  }
}

function saveToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(points));
  } catch (err) {
    console.error('Khong ghi duoc history.json:', err.message);
  }
}

function average(list, key) {
  const vals = list.map((p) => p[key]).filter((v) => v != null);
  if (!vals.length) return null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
}

function pushPoint(bucket, point) {
  points[bucket].push(point);
  const limit = LIMITS[bucket];
  if (points[bucket].length > limit) {
    points[bucket] = points[bucket].slice(points[bucket].length - limit);
  }
}

function recordSample(stats) {
  currentMinuteSamples.push({
    cpu: stats.cpu.loadOverall,
    mem: stats.memory.usedPercent,
    temp: stats.cpu.temperature,
  });
}

function msUntil(unit) {
  const now = new Date();
  const next = new Date(now);
  if (unit === 'minute') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
  } else if (unit === 'hour') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
  } else if (unit === 'day') {
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + 1);
  }
  return Math.max(next.getTime() - now.getTime(), 1000);
}

function scheduleAligned(unit, fn) {
  const run = () => {
    try {
      fn();
    } catch (err) {
      console.error(`Loi khi tong hop du lieu (${unit}):`, err.message);
    }
    setTimeout(run, msUntil(unit) + 500);
  };
  setTimeout(run, msUntil(unit) + 500);
}

function rollupMinute() {
  const pointTime = new Date();
  pointTime.setSeconds(0, 0);
  pointTime.setMinutes(pointTime.getMinutes() - 1);

  if (currentMinuteSamples.length) {
    pushPoint('minute', {
      t: pointTime.getTime(),
      cpu: average(currentMinuteSamples, 'cpu'),
      mem: average(currentMinuteSamples, 'mem'),
      temp: average(currentMinuteSamples, 'temp'),
    });
  }
  currentMinuteSamples = [];
  saveToDisk();
}

function rollupHour() {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  const prevHourStart = hourStart.getTime() - 60 * 60 * 1000;

  const slice = points.minute.filter((p) => p.t >= prevHourStart && p.t < hourStart.getTime());
  if (slice.length) {
    pushPoint('hour', {
      t: prevHourStart,
      cpu: average(slice, 'cpu'),
      mem: average(slice, 'mem'),
      temp: average(slice, 'temp'),
    });
    saveToDisk();
  }
}

function rollupDay() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const prevDayStart = new Date(dayStart);
  prevDayStart.setDate(prevDayStart.getDate() - 1);

  const slice = points.hour.filter((p) => p.t >= prevDayStart.getTime() && p.t < dayStart.getTime());
  if (slice.length) {
    pushPoint('day', {
      t: prevDayStart.getTime(),
      cpu: average(slice, 'cpu'),
      mem: average(slice, 'mem'),
      temp: average(slice, 'temp'),
    });
  }

  // Neu hom nay la ngay 1, thang truoc da ket thuc -> tong hop diem thang
  const today = new Date();
  if (today.getDate() === 1) {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    const monthSlice = points.day.filter((p) => p.t >= prevMonthStart.getTime() && p.t < monthStart.getTime());
    if (monthSlice.length) {
      pushPoint('month', {
        t: prevMonthStart.getTime(),
        cpu: average(monthSlice, 'cpu'),
        mem: average(monthSlice, 'mem'),
        temp: average(monthSlice, 'temp'),
      });
    }
  }
  saveToDisk();
}

function init() {
  loadFromDisk();
  scheduleAligned('minute', rollupMinute);
  scheduleAligned('hour', rollupHour);
  scheduleAligned('day', rollupDay);
}

const RANGE_CONFIG = {
  hour: { bucket: 'minute', count: 60 },
  day: { bucket: 'hour', count: 24 },
  month: { bucket: 'day', count: 30 },
  year: { bucket: 'month', count: 12 },
};

function getRange(range) {
  const cfg = RANGE_CONFIG[range] || RANGE_CONFIG.hour;
  const list = points[cfg.bucket];
  return list.slice(Math.max(0, list.length - cfg.count));
}

module.exports = { init, recordSample, getRange };
