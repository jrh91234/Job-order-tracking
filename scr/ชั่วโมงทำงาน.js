/*************************************************
 * สรุปชั่วโมงทำงาน (Google Apps Script)
 *
 * SOURCE  : ชีท "ยอดผลิต"
 * OUTPUT  : ชีท "ชั่วโมงทำงาน"
 *
 * กติกาล่าสุด:
 * 1) Group ตาม: Date + Recorder (ผู้บันทึก)
 * 2) Time(เวลา) เป็น "เวลาสิ้นสุดช่วง" (เช่น 09:00 คือช่วง 08:00-09:00) => ใช้เป็น endDT
 * 3) ชั่วโมงซ้ำในวันเดียวกันของ Recorder เดียวกัน (endDT ซ้ำ) => นับเป็น 1 ชั่วโมง (dedupe)
 * 4) ถ้า FG Qty (จำนวน) < 0 => ข้ามแถวนั้น (ไม่นำเวลามาคิด)
 * 5) เวลาเริ่มงาน Fix:
 *    - Day  เริ่ม 08:00 เสมอ
 *    - Nightเริ่ม 20:00 เสมอ
 * 6) เวลาพัก (หักเฉพาะช่วงที่ทับกับเวลาทำงานจริง):
 *    - 12:00-13:00
 *    - 17:00-17:30
 *    - 00:00-01:00 (วันถัดไป)
 *    - 05:00-05:30 (วันถัดไป)
 * 7) OT แยกคอลัมน์ (คิดจาก "ชั่วโมงสุทธิ" หลังหักพัก):
 *    - ถ้า ชั่วโมงสุทธิ > 8 => แสดง "OT"
 *    - ถ้าไม่ถึง/เท่ากับ 8 => เว้นว่าง
 * 8) เรียงผลลัพธ์: วันที่เก่าอยู่บน / วันที่ล่าสุดอยู่ล่างสุดเสมอ
 * 9) การตัดสินกะ: ใช้ "ช่วงเวลาที่มีข้อมูลจริง" ก่อน (กันเคสมี Night แค่ 1-2 ชม. แล้วไปเหมารวมทั้งวัน)
 *    - ถ้ามี endDT อยู่ในช่วง 08:00–20:00 ของวันนั้น => ถือเป็น Day
 *    - ถ้าไม่มีเลย => ถือเป็น Night
 *************************************************/

function updateชั่วโมงทำงาน() {
  const CFG = getConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---------- Read source ----------
  const src = ss.getSheetByName(CFG.SOURCE_SHEET);
  if (!src) throw new Error(`ไม่พบชีทต้นทาง "${CFG.SOURCE_SHEET}"`);

  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 2) return;

  const values = src.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0];

  const idx = resolveHeaderIndex_(header, CFG.HEADERS);
  validateHeaderIndex_(idx);

  // ---------- Aggregate ----------
  // groupKey = day|recorder
  const groups = new Map();
  // dedupeKey = day|recorder|endDT
  const seen = new Set();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];

    const recorder = String(row[idx.recorder] || "").trim();
    const dateObj = row[idx.date];
    const shift = String(row[idx.shift] || "").trim();
    const qty = toNumber_(row[idx.qty]);
    const endTimeStr = normalizeTime_(row[idx.time]);

    if (!recorder) continue;
    if (!(dateObj instanceof Date)) continue;
    if (!isNaN(qty) && qty < 0) continue;
    if (!endTimeStr) continue;

    const day = dateOnly_(dateObj);
    const endDT = buildEndDateTime_(day, endTimeStr, shift);

    const dedupeKey = `${day.getTime()}|${recorder}|${endDT.getTime()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const groupKey = `${day.getTime()}|${recorder}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, newGroup_(day, recorder, shift, endDT));
    } else {
      updateGroup_(groups.get(groupKey), shift, endDT);
    }
  }

  // ---------- Build output (sorted old -> new) ----------
  const outRows = Array.from(groups.values())
    .sort((a, b) => {
      const da = a.date.getTime();
      const db = b.date.getTime();
      if (da !== db) return da - db;
      return a.recorder.localeCompare(b.recorder, "th");
    })
    .map(g => buildOutputRow_(g, CFG));

  // ---------- Write output ----------
  let outSh = ss.getSheetByName(CFG.OUTPUT_SHEET);
  if (!outSh) outSh = ss.insertSheet(CFG.OUTPUT_SHEET);

  outSh.clearContents();
  outSh.getRange(1, 1, 1, CFG.OUTPUT_HEADER.length).setValues([CFG.OUTPUT_HEADER]);
  if (outRows.length) outSh.getRange(2, 1, outRows.length, CFG.OUTPUT_HEADER.length).setValues(outRows);

  // Format
  outSh.setFrozenRows(1);
  outSh.getRange("A:A").setNumberFormat("dd/MM/yyyy");
  outSh.getRange("E:F").setNumberFormat("dd/MM/yyyy HH:mm");
  outSh.getRange("G:I").setNumberFormat("0.00");
}

/*************************************************
 * CONFIG
 *************************************************/
function getConfig_() {
  return {
    SOURCE_SHEET: "ยอดผลิต",
    OUTPUT_SHEET: "ชั่วโมงทำงาน",

    HEADERS: {
      date: ["Date", "วันที่"],
      time: ["Time (เวลา)", "Time", "เวลา"],
      shift: ["Shift", "กะ"],
      recorder: ["Recorder (ผู้บันทึก)", "Recorder"],
      qty: ["FG Qty (จำนวน)", "FG Qty", "Qty", "จำนวน"],
    },

    START_TIME: {
      Day:   { h: 8,  m: 0 },
      Night: { h: 20, m: 0 },
    },

    OT_THRESHOLD_NET_HOURS: 8,

    // เวลาพัก (อิงจากวันของ startDT)
    BREAK_RULES: [
      { dayOffset: 0, start: "12:00", end: "13:00" },
      { dayOffset: 0, start: "17:00", end: "17:30" },
      { dayOffset: 1, start: "00:00", end: "01:00" },
      { dayOffset: 1, start: "05:00", end: "05:30" },
    ],

    // ใช้ตัดสินกะจากช่วงเวลาที่มีข้อมูลจริง
    DAY_WINDOW: { start: "08:00", end: "20:00" },

    OUTPUT_HEADER: [
      "วันที่ (อ้างอิงจาก Date)",
      "Recorder (ผู้บันทึก)",
      "กะ (สรุป)",
      "OT",
      "เวลาเข้างาน (Datetime)",
      "เวลาเลิกงาน (Datetime)",
      "ชั่วโมงรวม (ชม.)",
      "เวลาพักรวม (ชม.)",
      "ชั่วโมงสุทธิ (ชม.)",
      "จำนวน record (ชั่วโมงที่มีข้อมูล)",
    ],
  };
}

/*************************************************
 * GROUP STRUCTURE
 *************************************************/
function newGroup_(day, recorder, shift, endDT) {
  return {
    date: day,
    recorder: recorder,
    shifts: new Set([shift || ""]),
    endList: [endDT],
    hourCount: 1,
  };
}

function updateGroup_(g, shift, endDT) {
  g.shifts.add(shift || "");
  g.endList.push(endDT);
  g.hourCount++;
}

/*************************************************
 * OUTPUT ROW
 *************************************************/
function buildOutputRow_(g, CFG) {
  // ✅ ตัดสินกะจาก "ช่วงเวลาที่มีข้อมูลจริง" ก่อน
  const baseShift = decideShiftByHours_(g, CFG);

  // เวลาเข้า fix
  const startDT = new Date(g.date);
  const st = CFG.START_TIME[baseShift] || CFG.START_TIME.Day;
  startDT.setHours(st.h, st.m, 0, 0);

  // เวลาเลิก
  const endDT = pickEndDT_(g.date, g.endList, baseShift);

  // ชั่วโมงรวม/พัก/สุทธิ
  const grossH = (endDT - startDT) / 36e5;
  const breakH = calcBreakHours_(startDT, endDT, CFG.BREAK_RULES);
  const netH = round2_(grossH - breakH);

  // OT จากชั่วโมงสุทธิ
  const otFlag = (netH > (CFG.OT_THRESHOLD_NET_HOURS + 1e-9)) ? "OT" : "";

  return [
    g.date,
    g.recorder,
    baseShift,
    otFlag,
    startDT,
    endDT,
    round2_(grossH),
    round2_(breakH),
    netH,
    g.hourCount,
  ];
}

/*************************************************
 * SHIFT DECISION (แก้เคส 2 ชั่วโมง)
 * ถ้ามี endDT ในช่วง 08:00–20:00 ของ "วันนั้น" => Day
 * ถ้าไม่มีเลย => Night
 *************************************************/
function decideShiftByHours_(g, CFG) {
  const day = g.date;

  const [dsh, dsm] = CFG.DAY_WINDOW.start.split(":").map(Number);
  const [deh, dem] = CFG.DAY_WINDOW.end.split(":").map(Number);

  const dayStart = new Date(day); dayStart.setHours(dsh, dsm, 0, 0);
  const dayEnd   = new Date(day); dayEnd.setHours(deh, dem, 0, 0);

  const hasDayHours = (g.endList || []).some(dt => dt instanceof Date && dt >= dayStart && dt <= dayEnd);
  return hasDayHours ? "Day" : "Night";
}

/*************************************************
 * END TIME PICKING
 *************************************************/
function pickEndDT_(dayDateOnly, endList, baseShift) {
  if (!endList || !endList.length) return new Date(dayDateOnly);

  if (baseShift === "Night") {
    return maxDate_(endList);
  }

  // Day: ไม่เอาวันถัดไป (กันเคสลากถึงเช้าวันถัดไป)
  const dayEnd = new Date(dayDateOnly);
  dayEnd.setHours(23, 59, 59, 999);

  const sameDayEnds = endList.filter(d => d.getTime() <= dayEnd.getTime());
  return sameDayEnds.length ? maxDate_(sameDayEnds) : maxDate_(endList);
}

/*************************************************
 * BREAK CALC (Overlap)
 *************************************************/
function calcBreakHours_(startDT, endDT, breakRules) {
  const base = new Date(startDT);
  base.setHours(0, 0, 0, 0);

  let totalMs = 0;

  for (const br of breakRules) {
    const day = new Date(base);
    day.setDate(day.getDate() + (br.dayOffset || 0));

    const [sh, sm] = br.start.split(":").map(Number);
    const [eh, em] = br.end.split(":").map(Number);

    const bs = new Date(day); bs.setHours(sh, sm, 0, 0);
    const be = new Date(day); be.setHours(eh, em, 0, 0);

    totalMs += overlapMs_(startDT, endDT, bs, be);
  }

  return totalMs / 36e5;
}

function overlapMs_(startDT, endDT, bs, be) {
  return Math.max(
    0,
    Math.min(endDT.getTime(), be.getTime()) - Math.max(startDT.getTime(), bs.getTime())
  );
}

/*************************************************
 * BUILD END DATETIME
 * - Time เป็น "สิ้นสุดช่วง"
 * - Night และเวลา < 12:00 => วันถัดไป
 *************************************************/
function buildEndDateTime_(dayDateOnly, endTimeStr, shift) {
  const [hh, mm] = endTimeStr.split(":").map(Number);

  const endDT = new Date(dayDateOnly);
  endDT.setHours(hh, mm, 0, 0);

  const isNight = String(shift || "").toLowerCase().includes("night");
  if (isNight && hh < 12) endDT.setDate(endDT.getDate() + 1);

  return endDT;
}

/*************************************************
 * HEADER RESOLUTION
 *************************************************/
function resolveHeaderIndex_(headerRow, headersCfg) {
  return {
    date: findHeaderIndex_(headerRow, headersCfg.date),
    time: findHeaderIndex_(headerRow, headersCfg.time),
    shift: findHeaderIndex_(headerRow, headersCfg.shift),
    recorder: findHeaderIndex_(headerRow, headersCfg.recorder),
    qty: findHeaderIndex_(headerRow, headersCfg.qty),
  };
}

function validateHeaderIndex_(idx) {
  const missing = [];
  if (idx.date === -1) missing.push("Date");
  if (idx.time === -1) missing.push("Time (เวลา)");
  if (idx.shift === -1) missing.push("Shift");
  if (idx.recorder === -1) missing.push("Recorder (ผู้บันทึก)");
  if (idx.qty === -1) missing.push("FG Qty (จำนวน)");
  if (missing.length) throw new Error(`ไม่พบหัวตาราง: ${missing.join(", ")}`);
}

function findHeaderIndex_(headerRow, candidates) {
  const headers = headerRow.map(h => normalizeHeader_(h));
  for (const c of candidates) {
    const idx = headers.indexOf(normalizeHeader_(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function normalizeHeader_(v) {
  return String(v || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/*************************************************
 * UTILS
 *************************************************/
function normalizeTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");

  const s = String(v || "").trim();
  if (!s) return "";

  const parts = s.split(":"); // รองรับ 9:00 / 09:00 / 09:00:00
  if (parts.length < 2) return "";

  const hh = String(parseInt(parts[0], 10)).padStart(2, "0");
  const mm = String(parseInt(parts[1], 10)).padStart(2, "0");

  if (isNaN(Number(hh)) || isNaN(Number(mm))) return "";
  return `${hh}:${mm}`;
}

function dateOnly_(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function toNumber_(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").trim();
  if (!s) return NaN;
  return Number(s);
}

function maxDate_(arr) {
  return arr.reduce((mx, d) => (d > mx ? d : mx), arr[0]);
}
