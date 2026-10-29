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
  html.match(/const NORMAL_SHIFT_SPAN_HOURS = [^;]+;/)[0].replace('const ', 'var ') + '\n' +
  html.match(/const INCIDENT_NEARBY_MIN_LOST = [^;]+;/)[0].replace('const ', 'var ') + '\n' +
  html.match(/const INCIDENT_NEARBY_WINDOW_MIN = [^;]+;/)[0].replace('const ', 'var ') + '\n' +
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

// 2) ไม่มีการผลิตทั้งกะเช้า ไม่มี OT: แจ้ง 08:00 ไม่มีสแกนเลย → นับถึงเลิกงาน 17:00 หักพักเที่ยง = 480 นาที
const fullDay = [{ id: 'b', date: '2026-10-28', time: '08:00', line: '4', category: 'Material' }];
r = run(fullDay, []);
assert.equal(r[0].startFrom, 'report');
assert.equal(r[0].endBy, 'open');
assert.equal(r[0].hasOT, false);
assert.equal(r[0].endTs, at('2026-10-28', '17:00'));
assert.equal(Math.round(r[0].lostMin), 480);
// 2b) วันเดียวกันแต่กรอกคนช่วง OT ไว้ → นับถึง 20:00 หักพัก 12:00 (60) และ 17:00 (30) = 630 นาที
r = run(fullDay, [], { hasOT: (d, sh, l) => d === '2026-10-28' && sh === 'Day' && l === '4' });
assert.equal(r[0].hasOT, true);
assert.equal(Math.round(r[0].lostMin), 630);
// 2c) กะดึกไม่มี OT: แจ้ง 20:10 → นับถึง 05:00 หักพักเที่ยงคืน = 530 − 60 = 470
r = run([{ id: 'n', date: '2026-10-26', time: '20:10', line: '4', category: 'Other' }], []);
assert.equal(r[0].endTs, at('2026-10-27', '05:00'));
assert.equal(Math.round(r[0].lostMin), 470);
// 2d) มีสแกนหลังเลิกงาน (ทำ OT จริง) ถือว่าเป็นชั่วโมงทำงาน: สแกน 16:00 แจ้ง 16:30 กลับมา 18:00
r = run(
  [{ id: 'o', date: '2026-10-28', time: '16:30', line: '5', category: 'Material' }],
  [scan('5', '2026-10-28', '16:00'), scan('5', '2026-10-28', '18:00')]
);
assert.equal(r[0].endBy, 'resumed');
assert.equal(Math.round(r[0].lostMin), 120 - 30 - 1);
// 2e) แจ้งหลังเลิกงานโดยไม่มี OT ไม่นับเป็น downtime
r = run([{ id: 'late', date: '2026-10-28', time: '18:00', line: '5', category: 'Other' }], [scan('5', '2026-10-28', '16:00')]);
assert.equal(r.length, 0);

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

// 8) แจ้งตอนไลน์ยังสแกนอยู่ (ตรงเวลาที่แจ้งหยุดไม่ถึง 5 นาที) → ใช้ช่วงหยุดที่ยาวสุดในระยะ ±60 นาที
//    สแกน 03:20 หยุดถึง 03:41 (21 นาที) แล้วเดินต่อ แจ้งตอน 04:00 ขณะสแกนอยู่
const busy = ['03:00', '03:10', '03:20', '03:41', '03:50', '03:59', '04:00', '04:01', '04:10']
  .map(hm => ({ line: '5', ts: at('2026-10-23', hm), prodDate: '2026-10-22', model: 'A' }));
r = run([{ id: 'p', date: '2026-10-22', time: '04:00', line: '5', category: 'Material' }], busy);
assert.equal(r[0].matchedBy, 'nearby');
assert.equal(r[0].startTs, at('2026-10-23', '03:20'));
assert.equal(r[0].endTs, at('2026-10-23', '03:41'));
assert.equal(Math.round(r[0].lostMin), 20); // 21 − CT 1
// 8b) ไม่มีช่วงหยุดนานพอในระยะ ±60 นาที → คงช่องว่างเดิม (≈0)
const steady = Array.from({ length: 19 }, (_, i) => ({ line: '5', ts: at('2026-10-23', '03:00') + i * 4 * 60000, prodDate: '2026-10-22', model: 'A' }));
r = run([{ id: 'q', date: '2026-10-22', time: '04:00', line: '5', category: 'Material' }], steady);
assert.equal(r[0].matchedBy, 'report');
// 8c) สองเหตุการณ์ใกล้กันไม่หยิบช่วงหยุดเดียวกันซ้ำ: อันแรกได้ช่วงยาวสุด อันที่สองได้ช่วงถัดไป
// สแกนต่อเนื่องตั้งแต่ต้นกะ ทุก 4 นาที ช่วงต้นกะจึงไม่ใช่ช่วงหยุด
const busy2 = Array.from({ length: 15 }, (_, i) => ({ line: '5', ts: at('2026-10-28', '08:00') + i * 4 * 60000, prodDate: '2026-10-28', model: 'A' }))
  .concat(['09:00', '09:20', '09:21', '09:22', '09:35', '09:36', '09:37', '10:00'].map(hm => scan('5', '2026-10-28', hm)));
r = run([{ id: 'x1', date: '2026-10-28', time: '09:21', line: '5', category: 'Material' },
         { id: 'x2', date: '2026-10-28', time: '09:36', line: '5', category: 'Breakdown' }], busy2);
const byId = Object.fromEntries(r.map(x => [x.incident.id, x]));
assert.equal(byId.x1.matchedBy, 'nearby');
assert.equal(byId.x2.matchedBy, 'nearby');
assert.equal(byId.x1.startTs, at('2026-10-28', '09:37')); // ยาวสุด 23 นาที ตกเป็นของเหตุการณ์ที่แจ้งก่อน
assert.equal(byId.x2.startTs, at('2026-10-28', '09:00')); // อันที่สองได้ช่วงยาวสุดที่เหลือ
// 8d) ต้นกะยังไม่มีสแกน แจ้ง 09:00 สแกนแรก 09:00:28 → ใช้ช่วงต้นกะ 08:00 ถึงสแกนแรก
r = run([{ id: 'y', date: '2026-10-03', time: '09:00', line: '5', category: 'Breakdown' }],
  [{ line: '5', ts: at('2026-10-03', '09:00') + 28000, prodDate: '2026-10-03', model: 'A' }, scan('5', '2026-10-03', '09:05')]);
assert.equal(r[0].matchedBy, 'nearby');
assert.equal(r[0].startTs, at('2026-10-03', '08:00'));
assert.equal(Math.round(r[0].lostMin), 59);
console.log('Incident downtime: nearby stop matching when reported while still scanning passed');

// 9) "ทุกไลน์" ไม่นับไลน์ที่ไม่ได้เดินช่วงนั้น: Line 4 เดินแค่กะเช้า, Line 5 เดินกะดึก
//    แจ้งทุกไลน์ 20:13 กะดึก Line 5 สแกน 20:05 กลับมา 21:03 → นับแค่ Line 5 (58 − CT 1 = 57)
r = run([{ id: 'all-night', date: '2026-10-12', time: '20:13', line: 'All', category: 'Changeover' }],
  [scan('4', '2026-10-12', '10:00'), scan('4', '2026-10-12', '16:00'),
   scan('5', '2026-10-12', '20:05'), scan('5', '2026-10-12', '21:03'), scan('5', '2026-10-12', '21:10')]);
assert.equal(r.map(x => x.line).join(','), '5');
assert.equal(Math.round(r[0].lostMin), 57);
// 9b) ไลน์ที่หยุดไปนานก่อนแจ้ง (ไม่มีสแกนในระยะ ±60 นาที) ไม่ถูกนับเข้าเหตุการณ์ทุกไลน์
r = run([{ id: 'all-late', date: '2026-10-12', time: '23:34', line: 'All', category: 'Material' }],
  [scan('4', '2026-10-12', '20:10'), scan('4', '2026-10-12', '20:30'),
   scan('5', '2026-10-12', '23:30'), { line: '5', ts: at('2026-10-13', '01:10'), prodDate: '2026-10-12', model: 'A' }]);
assert.equal(r.map(x => x.line).join(','), '5');
// 23:30 → 01:10 = 100 − พักเที่ยงคืน 60 − CT 1 = 39
assert.equal(Math.round(r[0].lostMin), 39);
console.log('Incident downtime: All-lines incidents only count lines running near the report passed');

// 10) แจ้งซ่อมไม่มีรุ่น → เติมรุ่นที่ไลน์สแกนอยู่ ณ เวลาที่แจ้ง (findProducingAt)
const ctx2 = {};
vm.createContext(ctx2);
vm.runInContext('var processedScans = [];\n' + html.match(/let producingIndexCache = [^;]+;/)[0].replace('let ', 'var ') + '\n' + extract('findProducingAt'), ctx2);
const mk = (line, d, hm, model, jobOrder = 'J-' + model) => ({ line, ts: at(d, hm), status: 'OK', model, jobOrder });
ctx2.processedScans = [
  mk('5', '2026-10-13', '08:30', 'AAA'), mk('5', '2026-10-13', '09:00', 'AAA'),
  mk('5', '2026-10-13', '09:30', 'BBB'), mk('4', '2026-10-13', '09:05', 'CCC'),
  mk('5', '2026-10-13', '21:10', 'NIGHT'), { line: '5', ts: at('2026-10-14', '02:00'), status: 'OK', model: 'NIGHT2', jobOrder: 'MANUAL_MODE' }
];
let p = ctx2.findProducingAt('2026-10-13', '09:07', 9, '5');
assert.equal(p.model, 'AAA'); assert.equal(p.jobOrder, 'J-AAA');           // สแกนล่าสุดก่อนแจ้ง
assert.equal(ctx2.findProducingAt('2026-10-13', '09:40', 9, '5').model, 'BBB');
assert.equal(ctx2.findProducingAt('2026-10-13', '08:10', 8, '5').model, 'AAA'); // ยังไม่สแกนในกะ → สแกนแรกหลังแจ้ง
assert.equal(ctx2.findProducingAt('2026-10-13', '09:07', 9, '4').model, 'CCC'); // ไลน์ต่างกันไม่ปนกัน
p = ctx2.findProducingAt('2026-10-13', '02:30', 2, '5');                          // กะดึกหลังเที่ยงคืน
assert.equal(p.model, 'NIGHT2'); assert.equal(p.jobOrder, '');
assert.equal(ctx2.findProducingAt('2026-10-13', '20:05', 20, '5').model, 'NIGHT'); // ไม่ใช้สแกนกะเช้าข้ามมากะดึก
assert.equal(ctx2.findProducingAt('2026-10-13', '09:00', 9, 'All'), null);
console.log('Maintenance incidents: model at report time inferred from scans passed');
