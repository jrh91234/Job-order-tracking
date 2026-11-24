// Report production hours and line-level downtime use the same underlying records as the dashboard.
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
  var BREAK_MINUTES_BY_HOUR = {12: 60, 17: 30, 0: 60, 5: 30};
  var OT_THRESHOLD_NET_HOURS = 8, reportLang = 'en';
  var PDF_COLOR = { heading: '#111', sub: '#111', text: '#111', bad: '#f00' }, PDF_TABLE_LAYOUT = {};
  var filteredScans = [];
  function pdfCell(text) { return { text: String(text) }; }
  function pdfTotalCell(text) { return { text: String(text) }; }
  function pdfHeaderCell(text) { return { text }; }
  function pdfNote(text) { return { text }; }
  function pdfText(text) { return String(text); }
  function pdfHeading(text) { return [{ text }]; }
  var els = { kpiTotalScans: { textContent: '100' }, kpiAvgSpeed: { textContent: '10' }, kpiActiveModels: { textContent: '2' } };
  var lastHourlySummary = null, kpiLastScanOverallText = '-', kpiLastScanOverallElapsed = '-', REPORT_EFF_TARGET = 85;
  function rptEffColor() { return '#000'; }
  ${['countNetWorkHours', 'summarizeReportProductionHours', 'buildReportKpiContent', 'reportDowntimeComparisonAllowed', 'reportDowntimePercent', 'reportDowntimePercentText', 'buildReportDowntimeComparison', 'buildReportLineDowntimeContent', 'buildReportIncidentDowntimeSummary', 'buildReportIncidentsContent'].map(extract).join('\n')}
`, ctx);
const scan = (line, shift, hour, date = '2026-11-20') => ({ status: 'OK', line, shift, hour, prodDate: date });
const scans = [
  ...[8,9,10,11,12,13,14,15,16,17,18,19].map(h => scan('4', 'Day', h)),
  scan('4', 'Day', 8), // repeated scan does not add another hour
  scan('5', 'Day', 8), scan('5', 'Day', 9), // simultaneous lines count separately
  ...[20,21,0,1].map(h => scan('4', 'Night', h)),
  { ...scan('4', 'Day', 7), status: 'NG' },
  { ...scan('4', 'Day', 7), prodDate: '' }
];
const hours = ctx.summarizeReportProductionHours(scans);
assert.equal(hours.normal, 13);
assert.equal(hours.ot, 2.5);
assert.equal(hours.total, 15.5);
assert.deepEqual(Array.from(hours.byLine, h => [h.line, h.total, h.normal, h.ot]), [
  ['4', 13.5, 11, 2.5], ['5', 2, 2, 0]
]);
const extended = ctx.summarizeReportProductionHours([...scans, scan('4', 'Day', 8, '2026-11-21'), scan('', 'Day', 9)]);
assert.deepEqual(Array.from(extended.byLine, h => [h.line, h.total, h.normal, h.ot]), [
  ['4', 14.5, 12, 2.5], ['5', 2, 2, 0], ['-', 1, 1, 0]
]);
assert.equal(extended.byLine.reduce((sum, h) => sum + h.total, 0), extended.total);
ctx.filteredScans = scans;
const kpi = ctx.buildReportKpiContent();
assert.equal(kpi[2].table.body[0][0].stack[1].text, '15.5');
assert.equal(kpi[2].table.body[0][1].stack[1].text, '13.0');
assert.equal(kpi[2].table.body[0][2].stack[1].text, '2.5');
assert.deepEqual(Array.from(kpi[3].table.body[1], cell => cell.text), ['Line 4', '13.5', '11.0', '2.5']);
assert.deepEqual(Array.from(kpi[3].table.body[2], cell => cell.text), ['Line 5', '2.0', '2.0', '0.0']);
vm.runInContext(`
  var allFilteredRows = [];
  function formatThaiDate(date) { return date; }
  function getSelectedLabel(el, fallback) { return el ? el.value : fallback; }
  ${extract('getReportScope')}
`, ctx);
ctx.els.filterStartDate = { value: '2026-11-20' };
ctx.els.filterEndDate = { value: '2026-11-20' };
ctx.els.filterJob = { value: 'J1' };
ctx.els.filterModel = { value: 'All' };
const selectedScope = ctx.getReportScope();
assert.equal(selectedScope.jobValue, 'J1');
assert.equal(selectedScope.modelValue, 'All');
assert.equal(ctx.reportDowntimeComparisonAllowed(selectedScope), false);
ctx.reportLang = 'th';
ctx.filteredScans = [...scans, scan('', 'Day', 9)];
const thaiKpi = ctx.buildReportKpiContent();
assert.equal(thaiKpi[3].table.body[3][0].text, 'ไม่ระบุไลน์');
ctx.reportLang = 'en';
ctx.filteredScans = [scan('4', 'Day', 8), scan('5', 'Day', 8), scan('1', 'Day', 8)];
const data = {
  records: [
    { line: '4', fromChangeover: true, lostMin: 20 },
    { line: '4', fromChangeover: true, lostMin: 40 },
    { line: '4', fromChangeover: false, lostMin: 10 },
    { line: '5', fromChangeover: false, lostMin: 30 }
  ],
  byLineCategory: [
    { line: '4', categoryText: 'Changeover', count: 2, lostMin: 60 },
    { line: '4', categoryText: 'Material shortage', count: 1, lostMin: 10 },
    { line: '5', categoryText: 'Other', count: 1, lostMin: 30 }
  ],
  byCategory: [
    { categoryText: 'Changeover', count: 2, lostMin: 60 },
    { categoryText: 'Material shortage', count: 1, lostMin: 10 },
    { categoryText: 'Other', count: 1, lostMin: 30 }
  ], totalLostMin: 100
};
let blocks = ctx.buildReportLineDowntimeContent(data);
assert.equal(blocks[1].table.body[1][1].text, 'Changeover');
assert.equal(blocks[1].table.body[3][3].text, '70', 'line total includes both causes');
assert.equal(blocks[1].table.body[1][5].text, '1.0');
assert.equal(blocks[1].table.body[1][6].text, '100.0%');
assert.equal(blocks[1].table.body[3][6].text, '116.7%', 'comparison can exceed 100%');
assert.equal(blocks[3].table.body[1][0].text, '1');
assert.equal(blocks[3].table.body[1][3].text, '-', 'line without measurable changeovers');
assert.equal(blocks[3].table.body[2][0].text, '4');
assert.equal(blocks[3].table.body[2][1].text, '2');
assert.equal(blocks[3].table.body[2][3].text, '30.0');
assert.equal(blocks[3].table.body[3][0].text, '5');
blocks = ctx.buildReportIncidentDowntimeSummary({}, data);
assert.ok(blocks.some(b => b.text === 'Downtime by line and cause'));
assert.ok(blocks.some(b => b.text === 'Average changeover time by line'));
assert.equal(blocks[1].table.body[1][6].text, '33.3%', 'category compares against all 3 line-hours');
assert.equal(blocks[1].table.body[4][6].text, '55.6%', 'total compares against production hours');
const graph = blocks.find(b => b.table && b.table.body[0][0].text === 'Downtime as % of production hours');
assert.ok(graph);
assert.equal(graph.table.body[1][2].text, '55.6%');
assert.equal(graph.table.body[2][2].text, '33.3%');
const filtered = ctx.buildReportIncidentDowntimeSummary({ jobValue: 'J1', modelValue: 'All' }, data);
assert.equal(filtered[1].table.body[1][6].text, '-', 'incompatible Job filter does not produce a percentage');
assert.ok(filtered.some(b => b.text && b.text.includes('Percentages are unavailable')));
assert.ok(!filtered.some(b => b.table && b.table.body[0][0].text === 'Downtime as % of production hours'));
assert.equal(ctx.reportDowntimePercent(10, 0, true), null);
assert.equal(ctx.reportDowntimeComparisonAllowed({ modelValue: 'M1' }), false);
const empty = { records: [], byLineCategory: [], byCategory: [], totalLostMin: 0 };
blocks = ctx.buildReportIncidentDowntimeSummary({}, empty);
const emptyChangeoverIndex = blocks.findIndex(b => b.text === 'Average changeover time by line');
assert.ok(emptyChangeoverIndex >= 0);
assert.equal(blocks[emptyChangeoverIndex + 1].table.body[1][3].text, '-');
ctx.testDowntime = data;
vm.runInContext('function getIncidentsInRange() { return []; } function computeIncidentDowntime() { return testDowntime; }', ctx);
blocks = ctx.buildReportIncidentsContent({});
assert.ok(blocks.some(b => b.text === 'Average changeover time by line'), 'changeovers remain visible with no incident reports');
console.log('PDF production hours and line downtime tests passed');
