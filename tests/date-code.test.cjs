// ทดสอบการแปลง Date code บนฉลาก (TH YY WW D S L) และการหา Job order จากยอดสแกน (barcode.html)
process.env.TZ = 'Asia/Bangkok';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('barcode.html', 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  html.match(/const DATE_CODE_SHIFTS = [^;]+;/)[0].replace('const ', 'var ') + '\n' +
  ['dateCodeToIsoDate', 'parseDateCode', 'normalizeLineNo', 'findJobsByDateCode'].map(extract).join('\n'),
  ctx
);

// ตัวอย่างจากฉลากจริง: ปี 2026 สัปดาห์ 41 วันที่ 6 (ศุกร์) กะ B ไลน์ 4
const code = ctx.parseDateCode('TH 26 41 6 B 4');
assert.equal(code.date, '2026-10-09');
assert.equal(code.shift, 'Night');
assert.equal(code.line, '4');
assert.ok(ctx.parseDateCode('TH 26 41 6 4').error);
assert.equal(ctx.parseDateCode('TH2641 6B4').date, '2026-10-09');
assert.equal(ctx.parseDateCode('TH 26 41 1 A 4').date, '2026-10-04'); // วันที่ 1 = อาทิตย์
assert.equal(ctx.parseDateCode('TH 26 41 1 A 4').shift, 'Day');

// สัปดาห์ที่ 1 = สัปดาห์ที่มี 1 ม.ค. (2026-01-01 เป็นวันพฤหัส → อาทิตย์ของสัปดาห์ที่ 1 คือ 2025-12-28)
assert.equal(ctx.dateCodeToIsoDate(2026, 1, 1), '2025-12-28');
assert.equal(ctx.dateCodeToIsoDate(2026, 1, 5), '2026-01-01');
assert.equal(ctx.dateCodeToIsoDate(2023, 1, 1), '2023-01-01'); // 1 ม.ค. 2023 เป็นวันอาทิตย์

assert.ok(ctx.parseDateCode('TH 26 54 1 A 4').error);
assert.ok(ctx.parseDateCode('TH 26 41 8 A 4').error);
assert.ok(ctx.parseDateCode('TH 26 41 6 C 4').error);
assert.ok(ctx.parseDateCode('hello').error);

assert.equal(ctx.normalizeLineNo('Line 4'), '4');
assert.equal(ctx.normalizeLineNo('L04'), '4');

const scans = [
  { prodDate: '2026-10-09', shift: 'Night', line: '4', status: 'OK', jobOrder: 'J100', model: 'QWKDE3100LU24', ts: 2, time: '21:00:00' },
  { prodDate: '2026-10-09', shift: 'Night', line: '4', status: 'OK', jobOrder: 'J100', model: 'QWKDE3100LU24', ts: 1, time: '20:30:00', qty: 2 },
  { prodDate: '2026-10-09', shift: 'Night', line: '4', status: 'OK', jobOrder: 'J101', model: 'QWKDE3100LU18', ts: 5, time: '02:10:00' },
  { prodDate: '2026-10-09', shift: 'Night', line: '4', status: 'NG', jobOrder: 'J102', model: 'X', ts: 6, time: '03:00:00' },
  { prodDate: '2026-10-09', shift: 'Day', line: '4', status: 'OK', jobOrder: 'J200', model: 'X', ts: 0, time: '09:00:00' },
  { prodDate: '2026-10-09', shift: 'Night', line: '5', status: 'OK', jobOrder: 'J300', model: 'X', ts: 3, time: '22:00:00' },
  { prodDate: '2026-10-10', shift: 'Night', line: '4', status: 'OK', jobOrder: 'J400', model: 'X', ts: 9, time: '21:00:00' },
];
const jobs = ctx.findJobsByDateCode(scans, code);
assert.equal(jobs.map(j => j.jobOrder).join(','), 'J100,J101');
assert.equal(jobs[0].qty, 3);
assert.equal(jobs[0].firstTime, '20:30:00');
assert.equal(jobs[0].lastTime, '21:00:00');

console.log('date-code tests passed');
