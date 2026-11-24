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
console.log('pdf report tests passed');
