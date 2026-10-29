// ทดสอบการคิดเวลาที่หายไปตามสาเหตุที่แจ้ง (computeIncidentDowntimeCore ใน barcode.html)
process.env.TZ = 'Asia/Bangkok';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('barcode.html', 'utf8');
// ดึงซอร์สของฟังก์ชันออกมาจากหน้า โดยไล่วงเล็บปีกกาจนปิดครบ
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
  html.match(/const BREAK_MINUTES_BY_HOUR = [^;]+;/)[0].replace('const ', 'var ') + '\n' +
  ['breakOverlapMs', 'computeIncidentDowntimeCore', 'summarizeIncidentDowntime'].map(extract).join('\n'),
  ctx
);

const at = (d, hm) => new Date(`${d}T${hm}:00+07:00`).getTime();
const scan = (line, d, hm, model = 'A') => ({ line, ts: at(d, hm), prodDate: d, model });
const opts = { nowMs: at('2026-11-01', '00:00'), cycleSecondsByModel: { A: 60 }, breakOverlap: ctx.breakOverlapMs };
const run = (incidents, scans, extra = {}) => ctx.computeIncidentDowntimeCore(incidents, scans, { ...opts, ...extra });

// 1) หยุดกลางกะ: สแกนสุดท้าย 09:10 แจ้ง 09:15 กลับมาสแกน 09:50 → 40 นาที − CT 1 นาที = 39
let r = run(
  [{ id: 'a', date: '2026-10-28', time: '09:15', line: '5', category: 'Material' }],
  [scan('5', '2026-10-28', '09:00'), scan('5', '2026-10-28', '09:10'), scan('5', '2026-10-28', '09:50')]
);
assert.equal(r.length, 1);
assert.equal(r[0].startFrom, 'scan');
assert.equal(r[0].endBy, 'resumed');
assert.equal(Math.round(r[0].gapMin), 40);
assert.equal(Math.round(r[0].lostMin), 39);

// 2) ไม่มีการผลิตทั้งกะเช้า: แจ้ง 08:00 ไม่มีสแกนเลย → 08:00-20:00 หักพัก 12:00 (60) และ 17:00 (30) = 630 นาที
r = run([{ id: 'b', date: '2026-10-28', time: '08:00', line: '4', category: 'Material' }], []);
assert.equal(r[0].startFrom, 'report');
assert.equal(r[0].endBy, 'open');
assert.equal(Math.round(r[0].lostMin), 630);

// 3) หยุดคร่อมพักเที่ยง: 11:30 → 13:30 = 120 − พัก 60 − CT 1 = 59
r = run(
  [{ id: 'c', date: '2026-10-28', time: '11:40', line: '5', category: 'Breakdown' }],
  [scan('5', '2026-10-28', '11:30'), scan('5', '2026-10-28', '13:30')]
);
assert.equal(Math.round(r[0].breakMin), 60);
assert.equal(Math.round(r[0].lostMin), 59);

// 4) สองเหตุการณ์ในช่วงหยุดเดียวกัน แบ่งตามลำดับที่แจ้ง ไม่นับซ้ำ
r = run(
  [
    { id: 'd1', date: '2026-10-28', time: '09:05', line: '5', category: 'Breakdown' },
    { id: 'd2', date: '2026-10-28', time: '09:30', line: '5', category: 'Material' }
  ],
  [scan('5', '2026-10-28', '09:00'), scan('5', '2026-10-28', '10:00')]
);
assert.equal(r.length, 2);
assert.equal(Math.round(r[0].lostMin), 30); // 09:00-09:30
assert.equal(r[0].endBy, 'next');
assert.equal(Math.round(r[1].lostMin), 29); // 09:30-10:00 − CT
const byCat = ctx.summarizeIncidentDowntime(r, false);
assert.equal(byCat[0].category, 'Breakdown');
assert.equal(Math.round(byCat.reduce((s, g) => s + g.lostMin, 0)), 59);

// 5) กะดึกหลังเที่ยงคืน: วันผลิต 28 เวลา 02:10 คือ 29 ตามปฏิทิน · สแกน 02:00 กลับมา 02:40
r = run(
  [{ id: 'e', date: '2026-10-28', time: '02:10', line: '5', category: 'Breakdown' }],
  [scan('5', '2026-10-28', '20:30'), { line: '5', ts: at('2026-10-29', '02:00'), prodDate: '2026-10-28', model: 'A' },
   { line: '5', ts: at('2026-10-29', '02:40'), prodDate: '2026-10-28', model: 'A' }]
);
assert.equal(r[0].startTs, at('2026-10-29', '02:00'));
assert.equal(Math.round(r[0].lostMin), 39);

// 6) แจ้ง "ทุกไลน์" คิดแยกให้ทุกไลน์ที่เดินวันนั้น และเคารพตัวกรองไลน์
const allInc = [{ id: 'f', date: '2026-10-28', time: '10:00', line: 'All', category: 'Other' }];
const twoLines = [scan('4', '2026-10-28', '09:55'), scan('4', '2026-10-28', '10:20'),
                  scan('5', '2026-10-28', '09:50'), scan('5', '2026-10-28', '10:30')];
r = run(allInc, twoLines);
assert.equal(r.map(x => x.line).sort().join(','), '4,5');
r = run(allInc, twoLines, { onlyLine: '4' });
assert.equal(r.map(x => x.line).join(','), '4');

// 7) สแกนก่อนเริ่มกะไม่ถูกนับเป็นจุดเริ่มหยุด (สแกนกะดึกก่อนหน้าไม่ลากมาถึงกะเช้า)
r = run(
  [{ id: 'g', date: '2026-10-28', time: '08:30', line: '5', category: 'Material' }],
  [{ line: '5', ts: at('2026-10-28', '07:30'), prodDate: '2026-10-27', model: 'A' }, scan('5', '2026-10-28', '09:00')]
);
assert.equal(r[0].startFrom, 'report');
assert.equal(Math.round(r[0].lostMin), 29);

console.log('Incident downtime: gaps, breaks, full-shift stop, split incidents, night shift, All lines passed');
