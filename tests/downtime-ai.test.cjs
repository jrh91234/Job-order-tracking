// ทดสอบงาน AI สรุป Downtime ฝั่ง Apps Script (summarizeIncidentDowntimes ใน gas_sync_incidents.js)
process.env.TZ = 'Asia/Bangkok';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fmt = (date, zone, pattern) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  if (pattern === 'H') return String(Number(p.hour));
  if (pattern === 'HH:mm') return `${p.hour}:${p.minute}`;
  if (pattern === 'yyyy-MM-dd HH:mm') return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  return `${p.year}-${p.month}-${p.day}`;
};
const sheet = (name, rows, id = 1) => ({
  name, rows,
  getSheetId: () => id,
  getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  appendRow: r => rows.push(r),
  getLastRow: () => rows.length,
  getRange: (row) => ({ setValues: v => { rows[row - 1] = v[0]; } })
});
const spreadsheet = sheets => ({
  getSheetByName: n => sheets.find(s => s.name === n) || null,
  getSheets: () => sheets,
  insertSheet: n => { const s = sheet(n, []); sheets.push(s); return s; }
});

// เหตุการณ์ของเมื่อวาน (อยู่ในช่วงย้อนหลัง 7 วัน) วันที่คิดจากวันนี้ เทสต์จะได้ไม่หมดอายุ
const yd = new Date(Date.now() - 86400000);
const p2 = n => String(n).padStart(2, '0');
const DAY = `${yd.getFullYear()}-${p2(yd.getMonth() + 1)}-${p2(yd.getDate())}`;
const DAYBE = `${yd.getDate()}/${yd.getMonth() + 1}/${yd.getFullYear() + 543}`;
const NEXT = new Date(yd.getTime() + 86400000);
const NEXTDAY = `${NEXT.getFullYear()}-${p2(NEXT.getMonth() + 1)}-${p2(NEXT.getDate())}`;
const incidentsTab = sheet('Incidents', [
  ['ID', 'Date', 'Hour', 'Line', 'Model', 'JobOrder', 'Category', 'CategoryText', 'Notes', 'Time', 'Shift'],
  ['inc-1', DAY, 20, '5', 'All', '', 'Changeover', 'เปลี่ยนรุ่นล่าช้า', 'รอ W/H หา Box ให้ Box มาตอน 21:03', "'20:13", 'Night'],
  ['inc-new', '2099-01-01', 9, '5', 'All', '', 'Material', 'วัตถุดิบ', 'ยังไม่ถึงเวลา', "'09:00", 'Day']
]);
const mainSs = spreadsheet([incidentsTab]);
const barcodeRows = [['Date/Time', 'Barcode', 'Status', 'Model', 'Line']];
['20:02', '20:05', '21:03', '21:04', '21:06'].forEach((hm, i) => barcodeRows.push([`${DAYBE} ${hm}:00`, 'B' + i, 'OK', 'R9', '5']));
barcodeRows.push([`${DAYBE} 20:40:00`, 'X', 'NG', 'R9', '5']); // NG ไม่นับเป็นการผลิต
const barcodeSs = spreadsheet([sheet('Sheet1', barcodeRows, 0)]);

let prompts = [];
let geminiReply = () => [{ id: 'inc-1', start: '20:13', end: '21:03', minutes: 50, confidence: 'high', reason: 'Box มาตอน 21:03' }];
const cache = {};
const props = { GEMINI_API_KEY: 'test-key' };
let slept = 0;
let geminiUrls = [];
const ctx = {
  console: { warn() {}, log() {} },
  Utilities: { formatDate: fmt, sleep: ms => { slept += ms; } },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { openById: id => (id.startsWith('1OX5') ? barcodeSs : mainSs) },
  UrlFetchApp: {
    fetch: (url, opt) => {
      if (url.includes('generativelanguage')) {
        geminiUrls.push(url);
        prompts.push(JSON.parse(opt.payload).contents[0].parts[0].text);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply()) }] } }] }) };
      }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, data: [] }) };
    }
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('gas_sync_incidents.js', 'utf8'), ctx);
const at = (d, hm) => new Date(`${d}T${hm}:00+07:00`).getTime();

// --- ตัวช่วยทีละตัว ---
assert.equal(ctx.dtParseScanTs_(`${DAYBE} 21:03:00`), at(DAY, '21:03'));
assert.equal(ctx.dtIncidentTs_(DAY, '02:10'), at(NEXTDAY, '02:10'));
const win = ctx.dtShiftWindow_(DAY, 20);
assert.equal(win.normalEnd, at(NEXTDAY, '05:00'));
const gaps = ctx.dtScanGaps_([{ ts: at(DAY, '20:05') }, { ts: at(DAY, '21:03') }, { ts: at(DAY, '21:04') }],
  win, at(DAY, '18:00'), at(DAY, '23:00'), at(NEXTDAY, '12:00'));
assert.equal(gaps.gaps.map(g => g.kind).join(','), 'shift_start,gap,no_resume'); // 21:03→21:04 สั้นกว่า 3 นาทีไม่นับ · หลัง 21:04 ไม่มีสแกนอีก
assert.equal(gaps.gaps[1].minutes, 58);
// คำตอบ AI ที่เวลาหลุดกรอบถูกตัดให้อยู่ในช่วงทำงาน และคิดนาทีใหม่โดยหักพัก
const group = { win, ctx: { workEnd: at(NEXTDAY, '05:00') } };
const inc = { date: DAY, time: '23:30' };
let v = ctx.dtValidateResult_({ start: '23:30', end: '01:30', minutes: 999, confidence: 'high', reason: 'x' }, inc, group);
assert.equal(v.minutes, 60);            // 120 − พักเที่ยงคืน 60
v = ctx.dtValidateResult_({ start: null, end: null, minutes: 13, confidence: 'weird' }, inc, group);
assert.equal(v.minutes, 13); assert.equal(v.confidence, 'low');
assert.equal(ctx.dtValidateResult_({ minutes: 'abc' }, inc, group), null);

// --- รอบเต็ม ---
assert.match(ctx.summarizeIncidentDowntimes(), /summarized 1 of 1/);
const tab = mainSs.getSheetByName('IncidentDowntime').rows;
assert.equal(tab.length, 2);
const saved = Object.fromEntries(tab[0].map((h, i) => [h, tab[1][i]]));
assert.equal(saved.Key, "'inc-1|5"); assert.equal(saved.Minutes, 50); assert.equal(saved.By, "'AI");
assert.equal(prompts.length, 1);
assert.match(prompts[0], /Box มาตอน 21:03/);         // ข้อความที่แจ้งถูกส่งให้ AI
assert.match(prompts[0], /"from":"20:05","to":"21:03"/); // พร้อมช่วงหยุดสแกน
assert.doesNotMatch(prompts[0], /inc-new/);           // เหตุการณ์ที่ยังไม่ครบเวลารอ ไม่ถูกส่ง
assert.equal(cache.downtime_ai_running, undefined);   // ปลดธงหลังจบรอบ

// รอบถัดไปไม่มีอะไรใหม่ → ไม่เรียก AI ซ้ำ
assert.equal(ctx.summarizeIncidentDowntimes(), 'nothing to do');
assert.equal(prompts.length, 1);
// แก้ข้อความเหตุการณ์ → สรุปใหม่และเขียนทับแถวเดิม
incidentsTab.rows[1][8] = 'Box มาตอน 21:00';
geminiReply = () => [{ id: 'inc-1', start: '20:13', end: '21:00', minutes: 47, confidence: 'medium', reason: 'แก้ข้อความ' }];
ctx.summarizeIncidentDowntimes();
assert.equal(mainSs.getSheetByName('IncidentDowntime').rows.length, 2);
assert.equal(mainSs.getSheetByName('IncidentDowntime').rows[1][4], 47);
// GET_INCIDENTS ส่งผลสรุปไปให้หน้าเว็บ
ctx.LockService = { getScriptLock: () => ({ tryLock() {}, releaseLock() {} }) };
ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }) };
const res = ctx.doPost({ postData: { contents: '{"action":"GET_INCIDENTS"}' } });
assert.equal(res.downtimeSummaries.length, 1);
assert.equal(res.downtimeSummaries[0].Key, 'inc-1|5');
assert.equal(res.downtimeSummaries[0].Minutes, 47);
// Gemini ล่ม → ไม่เขียนอะไร ลองใหม่รอบหน้า
incidentsTab.rows[1][8] = 'แก้อีกครั้ง';
ctx.UrlFetchApp.fetch = (url) => url.includes('generativelanguage') ? { getResponseCode: () => 500 } : { getResponseCode: () => 200, getContentText: () => '{"success":true,"data":[]}' };
assert.match(ctx.summarizeIncidentDowntimes(), /summarized 0 of 1/);
assert.equal(mainSs.getSheetByName('IncidentDowntime').rows[1][4], 47);
console.log('Downtime AI: gaps, validation, summarize run, re-run on edit, GET_INCIDENTS and Gemini failure passed');

// --- โควตา Gemini แผนฟรี ---
assert.match(geminiUrls[0], /models\/gemini-2\.5-flash-lite:generateContent/); // ไม่ใช้โควตาก้อนเดียวกับการแปล PDF
props.GEMINI_DOWNTIME_MODEL = 'gemini-2.5-flash';
assert.match(ctx.dtCallGemini_.toString(), /GEMINI_DOWNTIME_MODEL/);
delete props.GEMINI_DOWNTIME_MODEL;
ctx.UrlFetchApp.fetch = (url, opt) => {
  if (url.includes('generativelanguage')) {
    geminiUrls.push(url);
    const ids = JSON.parse(JSON.parse(opt.payload).contents[0].parts[0].text.split('\n').pop()).incidents.map(i => i.id);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ids.map(id => ({ id, minutes: 5, confidence: 'low', reason: 'r' }))) }] } }] }) };
  }
  return { getResponseCode: () => 200, getContentText: () => '{"success":true,"data":[]}' };
};
// ไลน์สแกนต่อเนื่อง + ข้อความไม่มีตัวเลข → ตัดสินเอง 0 นาที ไม่เรียก AI
barcodeRows.length = 1;
for (let m = 0; m < 240; m += 2) {
  const t = new Date(at(DAY, '20:00') + m * 60000);
  barcodeRows.push([`${t.getDate()}/${t.getMonth() + 1}/${t.getFullYear() + 543} ${p2(t.getHours())}:${p2(t.getMinutes())}:00`, 'C' + m, 'OK', 'R9', '7']);
}
incidentsTab.rows.push(['steady', DAY, 21, '7', 'All', '', 'Quality', 'คุณภาพ', 'งานมีรอยขีดข่วน', "'21:00", 'Night']);
const callsBefore = geminiUrls.length;
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 1\b/);    // inc-1 (แก้ข้อความไว้) ต้องถาม AI, steady ไม่ต้อง
assert.equal(geminiUrls.length, callsBefore + 1);
const steadyRow = mainSs.getSheetByName('IncidentDowntime').rows.find(r => String(r[0]).includes('steady|7'));
assert.equal(steadyRow[4], 0); assert.equal(steadyRow[10], "'Rule");
// เพดานต่อรอบ 4 ครั้ง (เว้นระยะระหว่างครั้ง) และเพดานต่อวัน
for (let i = 0; i < 6; i++) incidentsTab.rows.push([`q${i}`, DAY, 22, String(10 + i), 'All', '', 'Material', 'วัตถุดิบ', 'รอ 10 นาที', "'22:00", 'Night']);
slept = 0;
const before2 = geminiUrls.length;
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 4, quota left today \d+, 2 groups wait for quota/);
assert.equal(geminiUrls.length, before2 + 4);
assert.equal(slept, 3 * 13000);                                    // 4 ครั้ง ต้องเว้น 3 ช่วง → ไม่เกิน 5 ครั้ง/นาที
props.DOWNTIME_AI_MAX_PER_DAY = String(Object.keys(props).filter(k => k.startsWith('downtime_ai_calls_')).map(k => Number(props[k]))[0]);
const before3 = geminiUrls.length;
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 0, quota left today 0, 2 groups wait for quota/); // วันนี้ใช้ครบแล้ว
assert.equal(geminiUrls.length, before3);
console.log('Downtime AI: Flash-Lite model, no-AI shortcut, per-run and daily quota caps passed');
