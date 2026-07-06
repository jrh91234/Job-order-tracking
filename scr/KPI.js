function updateKPI() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  // ชีทต้นทาง
  const sourceSheet = ss.getSheetByName('ยอดผลิต');
  if (!sourceSheet) throw new Error('ไม่พบชีทชื่อ "ยอดผลิต"');

  const kpiName = 'KPI';
  const data = sourceSheet.getDataRange().getValues();
  if (data.length < 2) return;

  const header = data[0];

  const timeCol   = header.indexOf('Time (เวลา)');
  const dateCol   = header.indexOf('Date');
  const joCol     = header.indexOf('Job order No. หมายเลขกำกับงาน');
  const modelCol  = header.indexOf('Model');
  const fgCol     = header.indexOf('FG Qty (จำนวน)');
  
  if ([timeCol, dateCol, joCol, modelCol, fgCol].some(i => i === -1)) {
    throw new Error('ชื่อหัวคอลัมน์ไม่ตรง กรุณาตรวจสอบชีท "ยอดผลิต"');
  }

  // ✅ ทำคีย์วันให้เป็นมาตรฐาน (แก้ Dup Hours = 0)
  const dateKey = (v) => {
    if (!v) return '';
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    }
    const s = String(v).trim();
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return Utilities.formatDate(dt, tz, 'yyyy-MM-dd');
    return s;
  };

  // แปลงเวลาเป็น HH:mm
  const timeKey = (v) => {
    if (!v) return '';
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, tz, 'HH:mm');
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    return s;
  };

  // กำหนดน้ำหนักชั่วโมง
  const hourWeight = (t) => (t === '06:00' || t === '18:00') ? 0.5 : 1;

  // ✅ นับซ้ำต่อวัน (ใช้ dKey เป็น string)
  const dayTimeCount = new Map(); // dKey -> Map(time -> count)

  // รวมข้อมูลต่อกลุ่ม (dKey + jo + model)
  const map = new Map();

  for (let i = 1; i < data.length; i++) {
    const r = data[i];

    const dKey  = dateKey(r[dateCol]);
    const jo    = r[joCol];
    const model = r[modelCol];
    if (!dKey || !jo || !model) continue;

    const t = timeKey(r[timeCol]);

    // ---- นับเวลาในวันนั้นแบบข้ามกลุ่ม ----
    if (t) {
      if (!dayTimeCount.has(dKey)) dayTimeCount.set(dKey, new Map());
      const tc = dayTimeCount.get(dKey);
      tc.set(t, (tc.get(t) || 0) + 1);
    }

    // ---- รวมยอดต่อกลุ่ม ----
    const key = `${dKey}||${jo}||${model}`;

    if (!map.has(key)) {
      map.set(key, {
        dKey,
        jo,
        model,
        fg: 0,
        target: 0,
        times: new Set(),   // เก็บเวลาไม่ซ้ำ (ภายในกลุ่ม)
      });
    }

    const obj = map.get(key);
    obj.fg     += Number(r[fgCol]) || 0;
  

    if (t) obj.times.add(t);
  }

  // ✅ คำนวณจำนวน "ชั่วโมงซ้ำ" ต่อวัน (time ที่ count > 1)
  const dayDupHours = new Map(); // dKey -> dupHours
  dayTimeCount.forEach((tc, dKey) => {
    let dupHours = 0;
    tc.forEach((count) => {
      if (count > 1) dupHours += 1;
    });
    dayDupHours.set(dKey, dupHours);
  });

  // เตรียมชีท KPI
  let kpiSheet = ss.getSheetByName(kpiName);
  if (!kpiSheet) kpiSheet = ss.insertSheet(kpiName);
  const REPORT_COLS = 8; // A:H
const maxRows = kpiSheet.getMaxRows();

// ล้างเฉพาะเนื้อหาในช่วงรายงาน KPI (ไม่ล้างคอลัมน์ที่คุณแทรกไว้ด้านข้าง)
kpiSheet.getRange(1, 1, maxRows, REPORT_COLS).clearContent();

  const output = [[
    'Date',
    'Job order No. หมายเลขกำกับงาน',
    'Model',
    'Hours',
    'Dup Hours (Day)',
    'Total FG Qty', 

  ]];

  Array.from(map.values())
    .sort((a, b) => {
      if (a.dKey !== b.dKey) return a.dKey.localeCompare(b.dKey);
      const j = String(a.jo).localeCompare(String(b.jo));
      if (j !== 0) return j;
      return String(a.model).localeCompare(String(b.model));
    })
    .forEach(o => {
      let hours = 0;
      o.times.forEach(t => hours += hourWeight(t));

      const dupHoursDay = dayDupHours.get(o.dKey) || 0;
      const diff = o.fg - o.target;

      // แสดงวันที่ให้เป็น dd/MM/yyyy
      const displayDate = Utilities.formatDate(new Date(o.dKey + 'T00:00:00'), tz, 'd/M/yyyy');

      output.push([displayDate, o.jo, o.model, hours, dupHoursDay, o.fg]);
    });

  kpiSheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  kpiSheet.setFrozenRows(1);
}

function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== 'ยอดผลิต') return; // ✅ ไม่ทำงานถ้าแก้ชีทอื่น
  updateKPI();
}

