// ทดสอบความเร็วเฉลี่ยจากชั่วโมงที่มีสแกน แยกตามวันผลิต
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('barcode.html', 'utf8');
const start = html.indexOf('function computeAverageSpeed(');
assert.ok(start >= 0, 'missing computeAverageSpeed');
let depth = 0;
let end = html.indexOf('{', start);
for (; end < html.length; end++) {
  if (html[end] === '{') depth++;
  if (html[end] === '}' && --depth === 0) break;
}
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end + 1), context);
const calculate = scans => JSON.parse(JSON.stringify(context.computeAverageSpeed(scans)));
const scan = (prodDate, hour, line, qty) => ({ prodDate, hour, line, qty });

assert.deepEqual(calculate([]), { total: 0, activeHours: 0, speed: 0 });
assert.deepEqual(calculate([
  scan('2026-11-01', 9, '4', 60),
  scan('2026-11-01', 9, '5', 40),
  scan('2026-11-01', 10, '4', 100)
]), { total: 200, activeHours: 2, speed: 100 }, 'ชั่วโมงเดียวกันของหลายไลน์นับครั้งเดียว');
assert.deepEqual(calculate([
  scan('2026-11-01', 9, '4', 100),
  scan('2026-11-02', 9, '4', 100),
  scan('2026-11-03', 9, '4', 100)
]), { total: 300, activeHours: 3, speed: 100 }, 'เวลาเดียวกันต่างวันนับแยกกัน');
assert.deepEqual(calculate([
  scan('2026-11-01', 23, '4', 60),
  scan('2026-11-01', 0, '4', 60),
  scan('2026-11-02', 0, '4', 60)
]), { total: 180, activeHours: 3, speed: 60 }, 'กะดึกใช้วันผลิตและชั่วโมงแยกอย่างถูกต้อง');
assert.deepEqual(calculate([
  scan('2026-11-01', 9, '4', 1),
  scan('2026-11-02', 9, '4', 2)
]), { total: 3, activeHours: 2, speed: 2 }, 'ปัดผลลัพธ์เป็นจำนวนเต็ม');

console.log('average speed tests passed');
