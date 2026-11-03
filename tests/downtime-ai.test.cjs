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
const logged = [];
const ctx = {
  console: { warn() {}, log(m) { logged.push(String(m)); }, error() {} },
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
assert.ok(logged.some(m => /^summarizeIncidentDowntimes: summarized 1 of 1/.test(m)));      // ผลต้องขึ้นใน log ของ editor
const tab = mainSs.getSheetByName('IncidentDowntime').rows;
assert.equal(tab.length, 2);
const saved = Object.fromEntries(tab[0].map((h, i) => [h, tab[1][i]]));
assert.equal(saved.Key, "'inc-1|5"); assert.equal(saved.Minutes, 50); assert.equal(saved.By, "'AI:gemini-lite");
assert.equal(prompts.length, 1);
assert.match(prompts[0], /Box มาตอน 21:03/);         // ข้อความที่แจ้งถูกส่งให้ AI
assert.match(prompts[0], /"from":"20:05","to":"21:03"/); // พร้อมช่วงหยุดสแกน
assert.doesNotMatch(prompts[0], /inc-new/);           // เหตุการณ์ที่ยังไม่ครบเวลารอ ไม่ถูกส่ง
assert.equal(cache.downtime_ai_running, undefined);   // ปลดธงหลังจบรอบ

// รอบถัดไปไม่มีอะไรใหม่ → ไม่เรียก AI ซ้ำ
assert.match(ctx.summarizeIncidentDowntimes(), /^nothing to do \(\d+ incidents read, \d+ in last 7 days: 1 already summarized/);
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

// --- โควตาและการสลับผู้ให้บริการ AI ---
assert.match(geminiUrls[0], /models\/gemini-2\.5-flash-lite:generateContent/); // ไม่ใช้โควตาก้อนเดียวกับการแปล PDF
const calls = [];
const reply = ids => JSON.stringify(ids.map(id => ({ id, minutes: 5, confidence: 'low', reason: 'r' })));
const idsOf = prompt => JSON.parse(prompt.split('\n').pop()).incidents.map(i => i.id);
let status = () => 200;
ctx.UrlFetchApp.fetch = (url, opt) => {
  if (url.includes('maintenance') || url === ctx.MAINTENANCE_API_URL) return { getResponseCode: () => 200, getContentText: () => '{"success":true,"data":[]}' };
  const body = JSON.parse(opt.payload);
  if (url.includes('generativelanguage')) {
    calls.push({ who: url.match(/models\/([^:]+)/)[1], opt });
    const code = status(calls[calls.length - 1].who);
    return { getResponseCode: () => code, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: reply(idsOf(body.contents[0].parts[0].text)) }] } }] }) };
  }
  if (url.includes('anthropic.com')) {
    calls.push({ who: 'claude', opt });
    return { getResponseCode: () => status('claude'), getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n' + reply(idsOf(body.messages[0].content)) + '\n```' }] }) };
  }
  calls.push({ who: url.includes('groq') ? 'groq' : 'openai', opt });
  return { getResponseCode: () => status(calls[calls.length - 1].who), getContentText: () => JSON.stringify({ choices: [{ message: { content: reply(idsOf(body.messages[0].content)) } }] }) };
};
const addGroups = (prefix, n, hour = '22:00') => {
  for (let i = 0; i < n; i++) incidentsTab.rows.push([`${prefix}${i}`, DAY, 22, `${prefix}${i}`, 'All', '', 'Material', 'วัตถุดิบ', 'รอ 10 นาที', `'${hour}`, 'Night']);
};
const byOf = id => (mainSs.getSheetByName('IncidentDowntime').rows.find(r => String(r[1]).replace(/^'/, '') === id) || [])[10];

// ไลน์สแกนต่อเนื่อง + ข้อความไม่มีตัวเลข → ตัดสินเอง 0 นาที ไม่เรียก AI
barcodeRows.length = 1;
for (let m = 0; m < 240; m += 2) {
  const t = new Date(at(DAY, '20:00') + m * 60000);
  barcodeRows.push([`${t.getDate()}/${t.getMonth() + 1}/${t.getFullYear() + 543} ${p2(t.getHours())}:${p2(t.getMinutes())}:00`, 'C' + m, 'OK', 'R9', '7']);
}
incidentsTab.rows.push(['steady', DAY, 21, '7', 'All', '', 'Quality', 'คุณภาพ', 'งานมีรอยขีดข่วน', "'21:00", 'Night']);
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 1, by gemini-lite 1\)/); // inc-1 (แก้ข้อความไว้) ต้องถาม AI, steady ไม่ต้อง
assert.equal(byOf('steady'), "'Rule");

// รอบละไม่เกิน 4 ครั้ง เว้นระยะระหว่างครั้ง
addGroups('q', 6);
slept = 0; calls.length = 0;
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 4, by gemini-lite 4, 2 groups wait for quota/);
assert.equal(slept, 3 * 13000);                                    // 4 ครั้ง ต้องเว้น 3 ช่วง → ไม่เกิน 5 ครั้ง/นาที

// Flash-Lite ตอบ 429 (โควตาเต็ม) → ใช้ Gemini 2.5 Flash แทน และไม่ลอง Flash-Lite อีกทั้งวัน
status = who => (who === 'gemini-2.5-flash-lite' ? 429 : 200);
calls.length = 0;
assert.match(ctx.summarizeIncidentDowntimes(), /by gemini-flash 2\)/);
assert.equal(calls.filter(c => c.who === 'gemini-2.5-flash-lite').length, 1);
assert.equal(byOf('q0'), "'AI:gemini-flash");

// Gemini 2.5 Flash ใช้ได้แค่วันละ 5 (เหลือให้การแปล PDF): ใช้ไปแล้ว 3 (2 ครั้งข้างบน + 1 ครั้งตอนทดสอบ Gemini ล่ม
// ที่ระบบลองทุกเจ้า) เหลือ 2 ใช้ครบแล้ว + ไม่มีเจ้าอื่น → รอ
addGroups('r', 5);
calls.length = 0;
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 3, by gemini-flash 2, 3 groups wait for quota/);
calls.length = 0;
assert.match(ctx.summarizeIncidentDowntimes(), /AI calls 1, by -, 3 groups wait for quota/);
assert.equal(calls.length, 0);                                     // ไม่ยิง Gemini เพิ่มเมื่อรู้ว่าเต็มทุกตัวแล้ว

// ตั้ง key ของ Groq + Claude เพิ่ม → ใช้ต่อตามลำดับ
props.GROQ_API_KEY = 'g';                                       // ไม่ตั้ง GROQ_MODEL → ใช้ค่าเริ่มต้น
props.ANTHROPIC_API_KEY = 'a';
status = who => (who === 'groq' ? 429 : who.startsWith('gemini') ? 429 : 200);
calls.length = 0;
assert.match(ctx.summarizeIncidentDowntimes(), /by claude 3\)/);
assert.equal(byOf('r0'), "'AI:claude");                            // r4, r3 ได้ไปก่อนด้วย Gemini Flash (เรียงกลุ่มจากท้ายไปต้น)                            // คำตอบที่ห่อด้วย ```json อ่านได้
const claudeCall = calls.find(c => c.who === 'claude').opt;
assert.equal(claudeCall.headers['x-api-key'], 'a');
assert.equal(claudeCall.headers['anthropic-version'], '2026-10-21');
assert.equal(claudeCall.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
const claudeBody = JSON.parse(claudeCall.payload);
assert.equal(claudeBody.model, 'claude-opus-5-5'); assert.equal(claudeBody.fallbacks, 'default');
const groqCall = calls.find(c => c.who === 'groq').opt;
assert.equal(groqCall.headers.Authorization, 'Bearer g');
assert.equal(JSON.parse(groqCall.payload).model, 'llama-3.3-70b-versatile');
// ผู้ให้บริการที่ไม่มีชื่อโมเดล (OpenAI ไม่ได้ตั้ง OPENAI_MODEL) ไม่ถูกใช้
props.OPENAI_API_KEY = 'o';
assert.equal(ctx.dtAiProviders_().some(pv => pv.id === 'openai'), false);
console.log('Downtime AI: provider chain, 429 failover, per-provider daily caps, Claude/Groq requests passed');

// --- ชื่อโมเดลถูกเลิกใช้ (404) → ถามรายชื่อโมเดลแล้วสลับเอง ---
assert.equal(ctx.dtPickModel_({ type: 'gemini', model: 'gemini-2.5-flash-lite' },
  ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite-preview', 'gemini-3.0-flash-lite', 'gemini-3.0-flash', 'gemini-flash-lite-latest', 'gemini-3.0-flash-lite-image']), 'gemini-flash-lite-latest');
assert.equal(ctx.dtPickModel_({ type: 'gemini', model: 'gemini-2.5-flash' },
  ['gemini-3.0-flash-lite', 'gemini-3.0-flash', 'gemini-3.5-flash-preview', 'gemini-3.0-pro']), 'gemini-3.0-flash');
assert.equal(ctx.dtPickModel_({ type: 'openai', model: 'llama-3.3-70b-versatile' },
  ['whisper-large-v3', 'llama-guard-4', 'openai/gpt-oss-120b', 'llama-4-70b-instruct']), 'llama-4-70b-instruct');
assert.equal(ctx.dtPickModel_({ type: 'openai', model: 'x' }, ['whisper-large-v3']), '');

for (const k of Object.keys(props)) if (/^downtime_ai_/.test(k)) delete props[k];
delete props.ANTHROPIC_API_KEY; delete props.OPENAI_API_KEY;
const seen = [];
ctx.UrlFetchApp.fetch = (url, opt = {}) => {
  seen.push(url);
  if (/v1beta\/models\?/.test(url)) {
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ models: [
      { name: 'models/gemini-3.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] }] }) };
  }
  if (url.includes('generativelanguage')) {
    const model = url.match(/models\/([^:]+)/)[1];
    if (model.startsWith('gemini-2.5')) {
      return { getResponseCode: () => 404, getContentText: () => JSON.stringify({ error: { message: `models/${model} is not found for API version v1beta` } }) };
    }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"id":"z","minutes":3}]' }] } }] }) };
  }
  return { getResponseCode: () => 500, getContentText: () => '{}' };
};
const okUsage = { available: () => true, use() {}, markFull() {} };
const got = ctx.dtCallAi_('prompt', okUsage);
assert.equal(got.provider, 'gemini-lite');
assert.equal(props['downtime_ai_model_gemini-lite'], 'gemini-3.0-flash-lite');   // จำไว้ใช้รอบหน้า
assert.equal(ctx.dtAiProviders_()[0].model, 'gemini-3.0-flash-lite');
seen.length = 0;
ctx.dtCallAi_('prompt', okUsage);
assert.equal(seen.length, 1);                                                       // รอบหน้าไม่ต้องถามรายชื่ออีก
// ตั้งชื่อโมเดลเองใน Script properties ยังมาก่อนค่าที่ระบบจำไว้
props.GEMINI_DOWNTIME_MODEL = 'gemini-mine';
assert.equal(ctx.dtAiProviders_()[0].model, 'gemini-mine');
delete props.GEMINI_DOWNTIME_MODEL;
// ข้อความ error ของผู้ให้บริการขึ้นใน log
props['downtime_ai_model_gemini-lite'] = 'gemini-2.5-gone';
ctx.UrlFetchApp.fetch = (url) => /models\?/.test(url)
  ? { getResponseCode: () => 403, getContentText: () => '{}' }
  : { getResponseCode: () => 404, getContentText: () => JSON.stringify({ error: { message: 'models/gemini-2.5-gone is not found' } }) };
assert.throws(() => ctx.dtCallAi_('prompt', okUsage), /HTTP 404 \(.*\): models\/gemini-2\.5-gone is not found/);
console.log('Downtime AI: 404 model discovery, remembered model, error detail passed');
