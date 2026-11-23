// ทดสอบการคำนวณว่าออร์เดอร์ที่เปิดอยู่พอขึ้นได้อีกกี่วัน (computeJobCoverageCore ใน barcode.html)
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
vm.runInContext(extract('computeJobCoverageCore'), ctx);

const jobs = [
  { job: 'J1', model: 'A', remaining: 600, rate: 1, coMin: 30 },  // 600 นาที
  { job: 'J2', model: 'A', remaining: 300, rate: 1, coMin: 30 },  // รุ่นเดิม ไม่เปลี่ยนรุ่นเพิ่ม
  { job: 'J3', model: 'B', remaining: 120, rate: 2, coMin: 40 }   // 60 นาที
];
// 2 ไลน์ วันละ 460 นาทีต่อไลน์ = 920 นาที/วัน
let r = ctx.computeJobCoverageCore(jobs, [], 920, 2);
assert.equal(r.productionMin, 960);
assert.equal(r.changeovers, 2, '1 ครั้งต่อรุ่น');
assert.equal(r.changeoverMin, 70);
assert.equal(r.totalMin, 1030);
assert.equal(r.fullDays, 1);
assert.equal(Math.round(r.leftHours * 60), 55, 'เหลือ 110 นาทีไลน์ ÷ 2 ไลน์ = 55 นาที');
assert.equal(r.qty, 1020);

// รุ่นที่ไลน์เดินอยู่แล้วไม่ต้องเปลี่ยนรุ่นเข้า
r = ctx.computeJobCoverageCore(jobs, ['A'], 920, 2);
assert.equal(r.changeovers, 1);
assert.equal(r.changeoverMin, 40);

// ไม่มี Job
r = ctx.computeJobCoverageCore([], [], 920, 2);
assert.equal(r.totalMin, 0);
assert.equal(r.fullDays, 0);

console.log('job coverage tests passed');
