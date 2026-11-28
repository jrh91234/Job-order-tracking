// ทดสอบการแปลง Date code บนฉลาก (TH YY WW D S L) และการหา Job order จากยอดสแกน (Job Monitor: index.html)
process.env.TZ = 'Asia/Bangkok';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
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
  ['dateCodeToIsoDate', 'looksLikeDateCode', 'parseDateCode', 'normalizeLineNo', 'toDateCodeScan', 'findJobsByDateCode'].map(extract).join('\n'),
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

assert.equal(ctx.looksLikeDateCode('TH 26 41'), true);
assert.equal(ctx.looksLikeDateCode('JO-2641'), false);
assert.equal(ctx.looksLikeDateCode('QWKDE3100'), false);

// วันผลิตและกะจากเวลาสแกน: หลังเที่ยงคืนนับเป็นกะดึกของวันก่อนหน้า
const ts = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
const raw = [
  { jobNo: 'J100', qty: 1, ts: ts(9, 21, 0), hour: 21, time24: '21:00', line: 'Line 4' },
  { jobNo: 'J100', qty: 2, ts: ts(9, 20, 30), hour: 20, time24: '20:30', line: 'Line 4' },
  { jobNo: 'J101', qty: 1, ts: ts(10, 2, 10), hour: 2, time24: '02:10', line: '4' },
  { jobNo: 'J200', qty: 1, ts: ts(9, 9, 0), hour: 9, time24: '09:00', line: '4' },
  { jobNo: 'J300', qty: 1, ts: ts(9, 22, 0), hour: 22, time24: '22:00', line: 'Line 5' },
  { jobNo: 'J400', qty: 1, ts: ts(10, 21, 0), hour: 21, time24: '21:00', line: '4' },
];
const scans = raw.map(ctx.toDateCodeScan);
assert.equal(scans[2].prodDate, '2026-10-09');
assert.equal(scans[2].shift, 'Night');
assert.equal(scans[3].shift, 'Day');
const jobs = ctx.findJobsByDateCode(scans, code);
assert.equal(jobs.map(j => j.jobNo).join(','), 'J100,J101');
assert.equal(jobs[0].qty, 3);
assert.equal(jobs[0].firstTime, '20:30');
assert.equal(jobs[0].lastTime, '21:00');

console.log('date-code tests passed');
