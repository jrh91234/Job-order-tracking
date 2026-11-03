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

const incidentsTab = sheet('Incidents', [
  ['ID', 'Date', 'Hour', 'Line', 'Model', 'JobOrder', 'Category', 'CategoryText', 'Notes', 'Time', 'Shift'],
  ['inc-1', '2026-11-02', 20, '5', 'All', '', 'Changeover', 'เปลี่ยนรุ่นล่าช้า', 'รอ W/H หา Box ให้ Box มาตอน 21:03', "'20:13", 'Night'],
  ['inc-new', '2099-01-01', 9, '5', 'All', '', 'Material', 'วัตถุดิบ', 'ยังไม่ถึงเวลา', "'09:00", 'Day']
]);
const mainSs = spreadsheet([incidentsTab]);
const barcodeRows = [['Date/Time', 'Barcode', 'Status', 'Model', 'Line']];
['20:02', '20:05', '21:03', '21:04', '21:06'].forEach((hm, i) => barcodeRows.push([`2/11/2569 ${hm}:00`, 'B' + i, 'OK', 'R9', '5']));
barcodeRows.push(['2/11/2569 20:40:00', 'X', 'NG', 'R9', '5']); // NG ไม่นับเป็นการผลิต
const barcodeSs = spreadsheet([sheet('Sheet1', barcodeRows, 0)]);

let prompts = [];
let geminiReply = () => [{ id: 'inc-1', start: '20:13', end: '21:03', minutes: 50, confidence: 'high', reason: 'Box มาตอน 21:03' }];
const cache = {};
const ctx = {
  console: { warn() {}, log() {} },
  Utilities: { formatDate: fmt },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-key' }) },
  SpreadsheetApp: { openById: id => (id.startsWith('1OX5') ? barcodeSs : mainSs) },
  UrlFetchApp: {
    fetch: (url, opt) => {
      if (url.includes('generativelanguage')) {
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
assert.equal(ctx.dtParseScanTs_('2/11/2569 21:03:00'), at('2026-11-02', '21:03'));
assert.equal(ctx.dtIncidentTs_('2026-11-02', '02:10'), at('2026-11-03', '02:10'));
const win = ctx.dtShiftWindow_('2026-11-02', 20);
assert.equal(win.normalEnd, at('2026-11-03', '05:00'));
const gaps = ctx.dtScanGaps_([{ ts: at('2026-11-02', '20:05') }, { ts: at('2026-11-02', '21:03') }, { ts: at('2026-11-02', '21:04') }],
  win, at('2026-11-02', '18:00'), at('2026-11-02', '23:00'), at('2026-11-03', '12:00'));
assert.equal(gaps.gaps.map(g => g.kind).join(','), 'shift_start,gap,no_resume'); // 21:03→21:04 สั้นกว่า 3 นาทีไม่นับ · หลัง 21:04 ไม่มีสแกนอีก
assert.equal(gaps.gaps[1].minutes, 58);
// คำตอบ AI ที่เวลาหลุดกรอบถูกตัดให้อยู่ในช่วงทำงาน และคิดนาทีใหม่โดยหักพัก
const group = { win, ctx: { workEnd: at('2026-11-03', '05:00') } };
const inc = { date: '2026-11-02', time: '23:30' };
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
