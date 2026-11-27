const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('barcode.html', 'utf8');
const start = html.indexOf('        function snapshotPowerPointTrends(');
const end = html.indexOf('        function powerPointChartImage(', start);
assert.ok(start >= 0 && end > start, 'PowerPoint trend helpers exist');
const context = { DAILY_TARGET_LABEL: 'เป้าหมาย (Target)', DAILY_EEF_LABEL: '%EEF' };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const labels = Array.from({ length: 26 }, (_, i) => `day ${i + 1}`);
const daily = { data: { labels, datasets: [
    { label: 'เป้าหมาย (Target)', data: labels.map(() => 100) },
    { label: '%EEF', data: labels.map((_, i) => i === 1 ? null : 90) },
    { type: 'bar', label: 'A', data: labels.map((_, i) => i) },
    { type: 'bar', label: 'B', data: labels.map(() => 5) }
] } };
const hourly = { hourLabels: ['08:00', '09:00'], actuals: [3, 0], targets: [5, 0] };
const snapshot = context.snapshotPowerPointTrends(hourly, daily);
assert.equal(snapshot.period.actual[3], 8, 'sum all model or group bars');
assert.equal(snapshot.period.target[3], 100);
assert.equal(snapshot.period.eef[1], null, 'missing efficiency must not become zero');
assert.equal(snapshot.hour.actual[1], 0, 'zero output remains zero');
assert.deepEqual(Array.from(context.splitPowerPointTrend(snapshot.period), c => c.labels.length), [12, 12, 2]);
daily.data.datasets[2].data[3] = 999;
hourly.actuals[0] = 999;
assert.equal(snapshot.period.actual[3], 8, 'refresh cannot alter the captured period');
assert.equal(snapshot.hour.actual[0], 3, 'refresh cannot alter the captured hour');
assert.equal(context.snapshotPowerPointTrends(null, null).period, null);
assert.equal(context.splitPowerPointTrend(null).length, 0);
console.log('PowerPoint trends: actual totals, missing values, pagination and stable snapshots passed');
