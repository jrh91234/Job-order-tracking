// PDF report chart aggregation and page-safe layout helpers in barcode.html
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
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`
  var PDF_COLOR = { sub: '#64748b', text: '#0f172a' };
  var groupByModel = { A: 'Group 1', B: 'Group 1', C: 'Group 2' };
  var groupByBarcode = { '123': 'Group 2' };
  var UNGROUPED_LABEL = 'ไม่ระบุกรุ๊ป';
  ${['getScanGroup', 'pdfText', 'pdfCell', 'reportWeekStart', 'reportChartData', 'reportBarChart', 'wrapReportText', 'wrapReportCells'].map(extract).join('\n')}
`, ctx);
const data = ctx.reportChartData([
  { prodDate: '2026-12-27', status: 'OK', model: 'A', qty: 3 },
  { prodDate: '2026-12-28', status: 'OK', model: 'A', qty: 4 },
  { prodDate: '2027-01-03', status: 'OK', model: 'B', qty: 5 },
  { prodDate: '2027-01-04', status: 'OK', model: 'unknown', barcode: '123', qty: 2 },
  { prodDate: '2027-01-04', status: 'OK', model: 'unknown2', qty: 1 },
  { prodDate: '2027-01-04', status: 'NG', model: 'A', qty: 100 }
]);
assert.deepEqual(Array.from(data.weeks, row => Array.from(row)), [['2026-12-21', 3], ['2026-12-28', 9], ['2027-01-04', 3]]);
assert.deepEqual(Array.from(data.groups, row => Array.from(row)), [['Group 1', 12], ['Group 2', 2], ['ไม่ระบุกรุ๊ป', 1]]);
assert.equal(ctx.reportWeekStart(''), '');
const chart = ctx.reportBarChart('ทดสอบ', data.groups, () => '#123456', true);
assert.equal(chart.table.body.length, 4);
assert.equal(chart.table.headerRows, 1);
assert.equal(chart.table.keepWithHeaderRows, 1);
assert.match(chart.table.body[1][2].text, /12 PCS \(80\.0%\)/);
assert.equal(chart.table.body[1][1].canvas[0].w, 275);
assert.ok(chart.table.widths.reduce((a, b) => a + b, 0) + 3 * 10 <= 535);
assert.equal(ctx.reportBarChart('empty', [], () => '#000', true), null);
const wrapped = ctx.wrapReportText('วัสดุขาดแคลน ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
assert.equal(wrapped.replace(/\s/g, ''), 'วัสดุขาดแคลนABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
assert.match(wrapped, /ABCDEFGHIJKLMNOPQR STUVWXYZ/);
const doc = { content: [ctx.pdfCell('วัสดุขาดแคลน'), { text: 'วัสดุขาดแคลน' }] };
ctx.wrapReportCells(doc.content);
assert.notEqual(doc.content[0].text, doc.content[1].text);
assert.equal(doc.content[0].text.replace(/\s/g, ''), doc.content[1].text);
assert.equal('reportWrap' in doc.content[0], false);

// Fixed chart labels must be English even when no translation service is available.
vm.runInContext(`
  var reportLang = 'en', PDF_CONTENT_WIDTH = 535;
  var hourlyChartObj = { toBase64Image: () => 'image' };
  var filteredScans = [{ prodDate: '2026-12-28', status: 'OK', model: 'unknown', qty: 4 }];
  function formatThaiDate(d) { return d; }
  function getGroupColor(g) { return g === UNGROUPED_LABEL ? '#999999' : '#123456'; }
  function pdfNote(text) { return { text }; }
  function pdfHeading(text) { return [{ text }]; }
  ${extract('buildReportChartsContent')}
`, ctx);
let charts = ctx.buildReportChartsContent();
assert.equal(charts[0].text, 'Production overview charts');
assert.match(charts[1].text, /Hourly production/);
assert.match(charts[3].table.body[0][0].text, /Weekly production/);
assert.match(charts[4].text, /selected dates and filters/);
assert.match(charts[5].table.body[0][0].text, /model group/);
assert.equal(charts[5].table.body[1][0].text, 'Unspecified group');
assert.equal(charts[5].table.body[1][1].canvas[0].color, '#999999');
assert.match(charts[6].table.body[0][0].text, /by model/);
ctx.reportLang = 'th';
charts = ctx.buildReportChartsContent();
assert.equal(charts[5].table.body[1][0].text, 'ไม่ระบุกรุ๊ป');
assert.match(charts[3].table.body[0][0].text, /รายสัปดาห์/);

// Reject stale or returned Thai translations and try the fallback before reporting failure.
vm.runInContext(`
  var THAI_CHAR_RE = /[\\u0E00-\\u0E7F]/, appsScriptUrl = 'configured';
  var translationCache = { 'หัวข้อ': 'หัวข้อ', 'หมายเหตุ': 'หมายเหตุ' };
  function loadReportTranslateCache() { return translationCache; }
  function saveReportTranslateCache(cache) { translationCache = cache; }
  async function translateViaGemini(texts) { return texts.map(() => 'ยังเป็นภาษาไทย'); }
  async function translateThaiToEnglish(text) { return text === 'หัวข้อ' ? 'Heading' : 'ยังแปลไม่ได้'; }
  ${['preCleanForEnglish', 'isReportEnglishTranslation', 'mapDocTexts'].map(extract).join('\n')}
  async ${extract('translateReportDocToEnglish')}
`, ctx);
(async () => {
  const translated = { info: { title: 'Report' }, content: [{ text: 'หัวข้อ' }, { text: 'หมายเหตุ' }] };
  assert.equal(await ctx.translateReportDocToEnglish(translated), 1);
  assert.equal(translated.content[0].text, 'Heading');
  assert.equal(translated.content[1].text, 'หมายเหตุ');
  console.log('pdf report tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
