// ทดสอบการคาดการณ์ยอดผลิต (simulateForecastCore / computeForecastRatesCore ใน barcode.html)
process.env.TZ = 'Asia/Bangkok';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('barcode.html', 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0;
  for (let i = html.indexOf(') {', start) + 2; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
const constLine = name => html.match(new RegExp(`const ${name} = [^;]+;`))[0].replace('const ', 'var ');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  ['BREAK_MINUTES_BY_HOUR', 'NORMAL_SHIFT_SPAN_HOURS', 'FORECAST_EXTRA_BREAKS', 'FORECAST_EDGE_MIN',
   'FORECAST_SHIFT_START_HOURS', 'FORECAST_SHIFT_END_HOURS', 'FORECAST_MIN_SAMPLE_HOURS'].map(constLine).join('\n') + '\n' +
  'var forecastBreakMinutesCache = null;\n' +
  ['forecastBreakMinutes', 'isForecastBreakMinute', 'forecastShiftWindow', 'forecastMedian',
   'computeForecastRatesCore', 'computeShiftEdgeLossCore', 'simulateForecastCore'].map(extract).join('\n'),
  ctx
);

const at = (d, hm) => new Date(`${d}T${hm}:00+07:00`).getTime();
const D = '2026-11-20';
const noBreak = () => false;
const sim = extra => ctx.simulateForecastCore({
  startMs: at(D, '08:00'), endMs: at(D, '17:00'), isBreakMinute: noBreak,
  rateFor: () => 1, changeoverMin: 0, prevModel: null, live: null, jobs: [], ...extra
});

// เวลาพัก: พักหลักเดิม + พักย่อย 10 นาที
assert.equal(ctx.isForecastBreakMinute(at(D, '10:05')), true, 'พักย่อย 10:00-10:10');
assert.equal(ctx.isForecastBreakMinute(at(D, '10:10')), false);
assert.equal(ctx.isForecastBreakMinute(at(D, '12:30')), true, 'พักเที่ยง');
assert.equal(ctx.isForecastBreakMinute(at(D, '03:09')), true, 'พักย่อยกะดึก 03:00-03:10');
assert.equal(ctx.isForecastBreakMinute(at(D, '22:10')), false);

// ช่วงกะ: เช้า 08-17 / OT 08-20 / ดึก 20-05 วันถัดไป
let w = ctx.forecastShiftWindow(D, 'Day', false);
assert.equal(w.startMs, at(D, '08:00')); assert.equal(w.endMs, at(D, '17:00'));
w = ctx.forecastShiftWindow(D, 'Day', true);
assert.equal(w.endMs, at(D, '20:00'));
w = ctx.forecastShiftWindow(D, 'Night', false);
assert.equal(w.startMs, at(D, '20:00')); assert.equal(w.endMs, at('2026-11-21', '05:00'));

// กะเช้าไม่มี OT ด้วยพักจริง: 9 ชม. = 540 นาที − เที่ยง 60 − พักย่อย 10 + 10 = 460 นาทีทำงาน
let r = sim({ isBreakMinute: ctx.isForecastBreakMinute, jobs: [{ key: 'J1', model: 'A', qty: 10000 }] });
assert.equal(Math.round(r.total), 460, 'นาทีทำงานสุทธิของกะเช้า');
assert.equal(Math.round(r.byHour[at(D, '12:00')] || 0), 0, 'ชั่วโมงพักเที่ยงไม่ได้ยอด');
assert.equal(Math.round(r.byHour[at(D, '10:00')]), 50, 'ชั่วโมงที่มีพักย่อยได้ 50 นาที');
assert.equal(r.jobs[0].workMinutes, 460, 'รายละเอียดนับเฉพาะนาทีผลิต ไม่รวมเวลาพัก');
assert.equal(r.jobs[0].workStartMs, at(D, '08:00'));
assert.equal(r.jobs[0].workEndMs, at(D, '17:00'));

// เรียง Job: เสร็จ Job แรกแล้วเปลี่ยนรุ่น เสียเวลาเปลี่ยนรุ่นก่อนเริ่ม Job ถัดไป
r = sim({ changeoverMin: 30, jobs: [{ key: 'J1', model: 'A', qty: 60 }, { key: 'J2', model: 'B', qty: 60 }] });
assert.equal(r.jobs[0].finishMs, at(D, '09:00'));
assert.equal(r.jobs[1].finishMs, at(D, '10:30'), 'J2 เริ่มหลังเปลี่ยนรุ่น 30 นาที');
assert.equal(Math.round(r.byHour[at(D, '09:00')]), 30);

// Job ต่อกันรุ่นเดียวกัน (เปลี่ยน lot) ไม่เสียเวลาเปลี่ยนรุ่น
r = sim({ changeoverMin: 30, jobs: [{ key: 'J1', model: 'A', qty: 60 }, { key: 'J2', model: 'A', qty: 60 }] });
assert.equal(r.jobs[1].finishMs, at(D, '10:00'));

// ไลน์เดินรุ่นอื่นอยู่ก่อนเริ่ม ต้องเปลี่ยนรุ่นก่อน / รุ่นเดียวกันเริ่มได้ทันที
r = sim({ changeoverMin: 20, prevModel: 'X', jobs: [{ key: 'J1', model: 'A', qty: 40 }] });
assert.equal(r.jobs[0].finishMs, at(D, '09:00'));
r = sim({ changeoverMin: 20, prevModel: 'A', jobs: [{ key: 'J1', model: 'A', qty: 40 }] });
assert.equal(r.jobs[0].finishMs, at(D, '08:40'));

// เวลาเปลี่ยนรุ่นไม่นับช่วงพัก (นับเฉพาะนาทีทำงาน เหมือน Changeover Lost)
r = ctx.simulateForecastCore({
  startMs: at(D, '09:50'), endMs: at(D, '17:00'), isBreakMinute: ctx.isForecastBreakMinute,
  rateFor: () => 1, changeoverMin: 20, prevModel: 'X', live: null, jobs: [{ key: 'J1', model: 'A', qty: 10 }]
});
assert.equal(r.jobs[0].finishMs, at(D, '10:30'), 'เปลี่ยนรุ่น 09:50-10:00 + 10:10-10:20 แล้วผลิต 10 นาที');

// ทำไม่ทันในกะ: finishMs เป็น null และยอดที่ทำได้ถูกตัดตามเวลาที่เหลือ
r = sim({ endMs: at(D, '09:00'), jobs: [{ key: 'J1', model: 'A', qty: 100 }] });
assert.equal(r.jobs[0].finishMs, null);
assert.equal(Math.round(r.jobs[0].produced), 60);

// ความเร็วสดใช้กับ Job แรกถึงเวลาที่กำหนด แล้วกลับไปใช้ความเร็วจากประวัติ
r = sim({ live: { ratePerMin: 2, untilMs: at(D, '09:00') }, jobs: [{ key: 'J1', model: 'A', qty: 1000 }], endMs: at(D, '10:00') });
assert.equal(Math.round(r.byHour[at(D, '08:00')]), 120);
assert.equal(Math.round(r.byHour[at(D, '09:00')]), 60);
// ไลน์หยุดอยู่ (ความเร็วสด 0) ชั่วโมงปัจจุบันจึงไม่ได้ยอดเพิ่ม
r = sim({ live: { ratePerMin: 0, untilMs: at(D, '09:00') }, jobs: [{ key: 'J1', model: 'A', qty: 1000 }], endMs: at(D, '10:00') });
assert.equal(Math.round(r.byHour[at(D, '08:00')] || 0), 0);

// ความเร็วจากประวัติ: เฉพาะชั่วโมงที่เดินรุ่นเดียวและสแกนครอบเกือบเต็มชั่วโมง ใช้ค่ากลาง
const scans = [];
const addHour = (d, h, line, model, perMin, fromMin = 0, toMin = 60) => {
  for (let m = fromMin; m < toMin; m++) for (let k = 0; k < perMin; k++) {
    scans.push({ line, model, qty: 1, ts: at(d, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`) + k * 1000 });
  }
};
addHour('2026-11-18', 8, '4', 'A', 5);                    // ชั่วโมงเข้ากะ: ไม่เอามาคิดความเร็วปกติ
addHour('2026-11-18', 18, '4', 'A', 1);
addHour('2026-11-18', 9, '4', 'A', 2);
addHour('2026-11-18', 11, '4', 'A', 1);
addHour('2026-11-18', 13, '4', 'A', 1, 0, 30);            // ไลน์หยุดครึ่งหลัง: ไม่เอามาเป็นตัวอย่าง
addHour('2026-11-18', 14, '4', 'A', 1, 0, 30); addHour('2026-11-18', 14, '4', 'B', 1, 30, 60); // มีเปลี่ยนรุ่น
addHour('2026-11-18', 10, '5', 'A', 3, 10, 60);           // ชั่วโมงที่มีพักย่อย: หาร 50 นาที
const rates = ctx.computeForecastRatesCore(scans, ctx.isForecastBreakMinute, at(D, '00:00'));
assert.equal(rates.byLineModel['4|A'].n, 3);
assert.equal(rates.byLineModel['4|A'].rate, 1, 'ค่ากลางของ 1, 2, 1');
assert.equal(rates.byLineModel['5|A'].rate, 3);
assert.equal(rates.byModel.A.n, 4);
assert.equal(rates.byLineModel['4|B'], undefined);

// เวลาที่เสียตอนเข้ากะ: หักก่อนเริ่มผลิต และหักก่อนเวลาเปลี่ยนรุ่น
r = sim({ startupMin: 25, changeoverMin: 10, prevModel: 'X', jobs: [{ key: 'J1', model: 'A', qty: 25 }] });
assert.equal(r.jobs[0].finishMs, at(D, '09:00'), 'เสีย 25 + เปลี่ยนรุ่น 10 แล้วผลิต 25 นาที');
assert.equal(Math.round(r.byHour[at(D, '08:00')]), 25);

// นาทีที่เสียในชั่วโมงแรกจากประวัติ: ความเร็วปกติ 1 ชิ้น/นาที
const hist = [];
const addRun = (d, shift, line, model, fromHm, toHm, perMin = 1) => {
  for (let t = at(d, fromHm); t < at(d, toHm); t += 60000) {
    for (let k = 0; k < perMin; k++) hist.push({ line, model, qty: 1, ts: t + k * 1000, prodDate: d, shift });
  }
};
// 3 วันที่ไลน์ 4 เริ่มสแกน 08:20, 08:30, 08:40 → ชั่วโมงแรกเสีย 20, 30, 40 นาที (ค่ากลาง 30)
addRun('2026-11-16', 'Day', '4', 'A', '08:20', '12:00');
addRun('2026-11-17', 'Day', '4', 'A', '08:30', '12:00');
addRun('2026-11-18', 'Day', '4', 'A', '08:40', '12:00');
// วันที่ไลน์ไม่ได้เดินต่อในชั่วโมงที่ 2 ไม่นับ
addRun('2026-11-19', 'Day', '4', 'A', '08:00', '08:10');
const histRates = ctx.computeForecastRatesCore(hist, ctx.isForecastBreakMinute, at(D, '00:00'));
assert.equal(histRates.byLineModel['4|A'].rate, 1, 'ความเร็วปกติไม่นับชั่วโมงเข้ากะ');
let edge = ctx.computeShiftEdgeLossCore(hist, ctx.isForecastBreakMinute, histRates, at(D, '00:00'));
assert.equal(edge.start.byLineShift['4|Day'].n, 3);
assert.equal(edge.start.byLineShift['4|Day'].min, 30);
assert.equal(edge.start.byShift.Day.min, 30);

// ชั่วโมงสุดท้าย: เลิก 17:00 แต่หยุดสแกน 16:45 → เสีย 15 นาที
const hist2 = [];
const add2 = (d, fromHm, toHm) => {
  for (let t = at(d, fromHm); t < at(d, toHm); t += 60000) {
    if (ctx.isForecastBreakMinute(t)) continue;
    hist2.push({ line: '5', model: 'C', qty: 1, ts: t, prodDate: d, shift: 'Day' });
  }
};
add2('2026-11-16', '13:00', '16:45');
add2('2026-11-17', '13:00', '16:45');
add2('2026-11-18', '13:00', '16:30');
// วันทำ OT: ชั่วโมงสุดท้ายคือ 19:00-20:00 หยุดสแกน 19:50 → เสีย 10 นาที
add2('2026-11-19', '13:00', '19:50');
const rates2 = ctx.computeForecastRatesCore(hist2, ctx.isForecastBreakMinute, at(D, '00:00'));
assert.equal(rates2.byLineModel['5|C'].rate, 1, 'ความเร็วปกติไม่นับชั่วโมงก่อนเลิก');
edge = ctx.computeShiftEdgeLossCore(hist2, ctx.isForecastBreakMinute, rates2, at(D, '00:00'));
assert.equal(edge.end.byLineShift['5|Day'].n, 4);
assert.equal(edge.end.byLineShift['5|Day'].min, 15, 'ค่ากลางของ 15, 15, 30, 10');

// จำลองท้ายกะ: หยุดผลิตก่อนเลิกตามนาทีที่เสีย
r = sim({ endLossMin: 15, jobs: [{ key: 'J1', model: 'A', qty: 10000 }] });
assert.equal(Math.round(r.byHour[at(D, '16:00')]), 45);
assert.equal(Math.round(r.total), 540 - 15);

// บันทึกช่วงเปลี่ยนรุ่น: เปลี่ยนรุ่นคร่อมพักเที่ยง นับนาทีแยกตามชั่วโมง (ชั่วโมงพักไม่มี)
r = ctx.simulateForecastCore({
  startMs: at(D, '11:00'), endMs: at(D, '17:00'), isBreakMinute: ctx.isForecastBreakMinute,
  rateFor: () => 1, changeoverMin: 49, startupMin: 0, prevModel: null, live: null,
  jobs: [{ key: 'J1', model: 'A', qty: 43 }, { key: 'J2', model: 'B', qty: 10 }]
});
assert.equal(r.changeovers.length, 1);
assert.equal(r.changeovers[0].fromModel, 'A');
assert.equal(r.changeovers[0].startMs, at(D, '11:43'));
assert.equal(r.changeovers[0].endMs, at(D, '13:32'));
assert.equal(r.changeovers[0].minutesByHour[at(D, '11:00')], 17);
assert.equal(r.changeovers[0].minutesByHour[at(D, '13:00')], 32);
assert.equal(r.changeovers[0].minutesByHour[at(D, '12:00')], undefined);
// เวลาเข้ากะไม่นับเป็นการเปลี่ยนรุ่น
r = sim({ startupMin: 20, changeoverMin: 10, prevModel: 'A', jobs: [{ key: 'J1', model: 'A', qty: 5 }] });
assert.equal(r.changeovers.length, 0);

// ยอดรายรุ่นของแต่ละชั่วโมง: ชั่วโมงที่เปลี่ยนรุ่นมีทั้งรุ่นเดิมและรุ่นใหม่
r = sim({ changeoverMin: 20, jobs: [{ key: 'J1', model: 'A', qty: 30 }, { key: 'J2', model: 'B', qty: 100 }] });
assert.equal(Math.round(r.byHourModel[at(D, '08:00')].A), 30);
assert.equal(Math.round(r.byHourModel[at(D, '08:00')].B), 10, 'เปลี่ยนรุ่น 08:30-08:50 แล้วผลิต B 10 นาที');
assert.equal(Math.round(r.byHourModel[at(D, '09:00')].B), 60);
assert.equal(r.jobs[0].workMinutes, 30);
assert.equal(r.jobs[1].workMinutes, 100);
assert.equal(r.jobs[1].workStartMs, at(D, '08:50'), 'เวลาผลิตเริ่มหลังเปลี่ยนรุ่น');

// รายการคำนวณแสดงผลจำลองเต็มกะ จำนวนแผน และเวลาที่เสียระหว่างเปลี่ยนรุ่น
vm.runInContext(`
  var FORECAST_RATE_SOURCE_TEXT = { line: 'ประวัติไลน์นี้' };
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  ${extract('forecastHM')}
  ${extract('forecastCalculationDetails')}
`, ctx);
const details = ctx.forecastCalculationDetails({
  plan: { id: 'plan1' }, win: { startMs: at(D, '08:00'), endMs: at(D, '17:00') },
  startup: { min: 0 }, ending: { min: 0 }, baseline: r,
  jobStatus: [
    { key: 'J1', model: 'A', rate: { rate: 1, source: 'line', n: 3 } },
    { key: 'J2', model: 'B', rate: { rate: 1, source: 'line', n: 3 } }
  ]
}, [{ qty: 30 }, { qty: 100 }], true);
assert.match(details, /เปลี่ยน A → B 08:30–08:50 · 20 นาทีทำงาน/);
assert.match(details, /เวลาผลิต 100 นาที · 08:50–10:30/);
assert.match(details, /รวมจำลองเต็มกะ ≈ 130 ชิ้น · แผนรวม 130 ชิ้น/);
assert.match(details, /<details[^>]* open /);

// แผนที่เปิดแก้ไขต้องคงจำนวนเดิม แม้ยอดคงเหลือของ Job เปลี่ยนไปแล้ว
vm.runInContext(`
  var forecastPlans = {}, forecastDraft;
  function forecastPlanId(date, shift, line) { return [date, shift, line].join('_'); }
  function forecastJobWant() { throw new Error('opening a saved plan must not recalculate its quantity'); }
  ${extract('loadForecastDraft')}
  ${extract('capForecastDraftToCapacity')}
`, ctx);
ctx.forecastPlans[`${D}_Day_4`] = { ot: false, jobs: [{ job: 'J1', model: 'A', qty: 300 }] };
ctx.loadForecastDraft(D, 'Day', '4');
assert.equal(ctx.forecastDraft.jobs[0].want, 300);
ctx.capForecastDraftToCapacity(ctx.forecastDraft);
assert.equal(ctx.forecastDraft.jobs[0].qty, 300, 'เปิดแผนเดิมแล้วจำนวนไม่เปลี่ยน');

// เมื่อต้องตัดตามกำลังผลิต ให้ใช้ผลจำลองตั้งแต่ต้นกะเสมอ แม้ขณะนี้อยู่ระหว่างกะ
let simulationTime;
ctx.computePlanForecast = (plan, now) => {
  simulationTime = now;
  return { jobStatus: plan.jobs.map(() => ({ forecastQty: 250.8 })) };
};
ctx.forecastDraft.preserveQty = false;
ctx.capForecastDraftToCapacity(ctx.forecastDraft);
assert.equal(simulationTime, at(D, '08:00'));
assert.equal(ctx.forecastDraft.jobs[0].qty, 250);

// สถิติอ้างอิงต้องไม่รวมข้อมูลการผลิตของวันในแผนที่กำลังเปลี่ยนระหว่างกะ
const statsCtx = { processedScans: [
  { status: 'OK', prodDate: '2026-11-19' },
  { status: 'OK', prodDate: D }
] };
vm.createContext(statsCtx);
vm.runInContext(`
  var FORECAST_HISTORY_DAYS = 30, forecastStatsCache = {};
  function isForecastBreakMinute() { return false; }
  function computeForecastRatesCore(scans) { return { count: scans.length }; }
  function computeShiftEdgeLossCore() { return {}; }
  function computeChangeoverEvents(opts) { globalThis.lastChangeoverRange = opts; return []; }
  ${extract('toLocalDateKey')}
  ${extract('forecastAddDays')}
  ${extract('getForecastStats')}
`, statsCtx);
assert.equal(statsCtx.getForecastStats(D).rates.count, 1);
assert.equal(statsCtx.lastChangeoverRange.endDate, '2026-11-19');

console.log('forecast tests passed');
