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
  ['dateCodeToIsoDate', 'looksLikeDateCode', 'parseDateCode', 'normalizeLineNo', 'findShiftColumn', 'normalizeShiftName', 'parseBarcodeRecordRows', 'findJobsByDateCode'].map(extract).join('\n'),
  ctx
);

// ตัวอย่างจากฉลากจริง: ปี 2026 สัปดาห์ 41 วันที่ 6 (ศุกร์) กะ B ไลน์ 4
const code = ctx.parseDateCode('TH 26 41 6 B 4');
assert.equal(code.date, '2026-10-09');
assert.equal(code.shiftCode, 'B');
assert.equal(code.line, '4');
assert.ok(ctx.parseDateCode('TH 26 41 6 4').error);
assert.equal(ctx.parseDateCode('TH2641 6B4').date, '2026-10-09');
assert.equal(ctx.parseDateCode('TH 26 41 1 A 4').date, '2026-10-04'); // วันที่ 1 = อาทิตย์
assert.equal(ctx.parseDateCode('TH 26 41 1 A 4').shiftCode, 'A');

// สัปดาห์ที่ 1 = สัปดาห์ที่มี 1 ม.ค. (2026-01-01 เป็นวันพฤหัส → อาทิตย์ของสัปดาห์ที่ 1 คือ 2025-12-28)
assert.equal(ctx.dateCodeToIsoDate(2026, 1, 1), '2025-12-28');
assert.equal(ctx.dateCodeToIsoDate(2026, 1, 5), '2026-01-01');
assert.equal(ctx.dateCodeToIsoDate(2023, 1, 1), '2023-01-01'); // 1 ม.ค. 2023 เป็นวันอาทิตย์

assert.ok(ctx.parseDateCode('TH 26 54 1 A 4').error);
assert.ok(ctx.parseDateCode('TH 26 41 8 A 4').error);
assert.equal(ctx.parseDateCode('TH 26 41 6 C 4').shiftCode, 'C'); // ชื่อกะเป็นอะไรก็ได้ตามชีต
assert.ok(ctx.parseDateCode('hello').error);

assert.equal(ctx.normalizeLineNo('Line 4'), '4');
assert.equal(ctx.normalizeLineNo('L04'), '4');

assert.equal(ctx.looksLikeDateCode('TH 26 41'), true);
assert.equal(ctx.looksLikeDateCode('JO-2641'), false);
assert.equal(ctx.looksLikeDateCode('QWKDE3100'), false);

// อ่านแถวจากแท็บ Log ของ Barcode Record: หลังเที่ยงคืนนับเป็นกะดึกของวันก่อนหน้า
const row = (dt, job, model, line, extra = {}) => ({ 'Date/Time': dt, Barcode: 'B-' + model, Model: model, Status: 'OK', Line: line, 'Job Order': job, Shift: 'B', ...extra });
const rows = [
  row('9/10/2569 21:00:00', 'J100', 'QWKDE3100LU24', '4'),
  row('9/10/2569 20:30:00', 'J100', 'QWKDE3100LU24', '4', { ScanGroupID: 'g1' }),
  row('9/10/2569 20:30:00', 'J100', 'QWKDE3100LU24', '4', { ScanGroupID: 'g1' }), // กลุ่มเดียวกัน = 2 ชิ้น
  row('10/10/2569 02:10:00', 'J101', 'QWKDE3100LU18', 'Line 4'),
  row('10/10/2569 02:10:00', 'J101', 'QWKDE3100LU18', 'Line 4'), // ไม่มี ScanGroupID และเวลาซ้ำ = ซ้ำ
  row('9/10/2569 23:00:00', 'J102', 'X', '4', { Status: 'NG' }),
  row('9/10/2569 23:30:00', 'J100', 'X', '4', { Status: 'CHANGEOVER', Barcode: 'FROM Y' }),
  row('9/10/2569 09:00:00', 'J200', 'X', '4', { Shift: 'A' }), // กะ A ไม่ตรง
  row('9/10/2569 10:00:00', 'J500', 'Y', '4', { Shift: 'Shift B' }), // กะ B ทำงานกลางวันก็ต้องเจอ
  row('9/10/2569 22:00:00', 'J300', 'X', '5'),
  row('10/10/2569 21:00:00', 'J400', 'X', '4'),
  { 'Date/Time': 'Date/Time' },
];
const scans = ctx.parseBarcodeRecordRows(rows);
const j101 = scans.find(s => s.jobNo === 'J101');
assert.equal(j101.prodDate, '2026-10-09');
assert.equal(j101.shift, 'B');
assert.equal(scans.filter(s => s.jobNo === 'J101').length, 1);
assert.equal(scans.find(s => s.jobNo === 'J200').shift, 'A');
assert.equal(scans.find(s => s.jobNo === 'J500').shift, 'B');
assert.ok(!scans.some(s => s.status === 'CHANGEOVER'));
const jobs = ctx.findJobsByDateCode(scans, code);
assert.equal(jobs.map(j => j.jobNo).join(','), 'J500,J100,J101');
assert.equal(jobs[1].qty, 3);
assert.equal(jobs[1].firstTime, '20:30');
assert.equal(jobs[1].lastTime, '21:00');
assert.equal(Object.keys(jobs[2].models).join(','), 'QWKDE3100LU18');
assert.equal(ctx.findJobsByDateCode(scans, ctx.parseDateCode('TH 26 41 6 A 4')).map(j => j.jobNo).join(','), 'J200');

assert.equal(ctx.findShiftColumn(['Date/Time', 'Line', 'Shift']), 'Shift');
assert.equal(ctx.findShiftColumn(['Date/Time', 'กะ']), 'กะ');
assert.equal(ctx.findShiftColumn(['Date/Time', 'Line']), null);
assert.equal(ctx.normalizeShiftName(' กะ b '), 'B');

// รูปแบบจริงจากแท็บ Log: ชั่วโมงหลักเดียว, Shift เป็น "Shift B", ScanGroupID ไม่ซ้ำกันทุกแถว, มีแถว VOID
const real = ctx.parseBarcodeRecordRows([
  { 'Date/Time': '9/10/2569 15:36:35', 'Job Order': 'M0-20260915-000784', Model: 'QWKDE3100LU24', Barcode: '3606487608738', Status: 'VOID', Line: '4', Shift: 'Shift A', ScanGroupID: 'v1' },
  { 'Date/Time': '9/10/2569 20:44:56', 'Job Order': 'M0-20260915-000784', Model: 'QWKDE3100LU24', Barcode: '3606487608738', Status: 'OK', Line: '4', Shift: 'Shift B', ScanGroupID: 'u1' },
  { 'Date/Time': '9/10/2569 20:46:05', 'Job Order': 'M0-20260915-000784', Model: 'QWKDE3100LU24', Barcode: '3606487608738', Status: 'OK', Line: '4', Shift: 'Shift B', ScanGroupID: 'u2' },
  { 'Date/Time': '9/10/2569 20:48:45', 'Job Order': 'M0-20261008-001923', Model: 'EZ9EPL114', Barcode: '3606487370550', Status: 'OK', Line: '5', Shift: 'Shift A', ScanGroupID: 'u3' },
  { 'Date/Time': '10/10/2569 8:05:00', 'Job Order': 'M0-X', Model: 'X', Barcode: '1', Status: 'OK', Line: '4', Shift: 'Shift A', ScanGroupID: 'u4' },
]);
assert.equal(real.find(s => s.jobNo === 'M0-X').time, '08:05');
const realJobs = ctx.findJobsByDateCode(real, code);
assert.equal(realJobs.map(j => j.jobNo).join(','), 'M0-20260915-000784');
assert.equal(realJobs[0].qty, 2);
assert.equal(realJobs[0].firstTime, '20:44');

console.log('date-code tests passed');
