const H9_BARCODE_RECORD_SPREADSHEET_ID = '1OX5aKM-TuJPJIT_7v3Lq5WcvixxUo3ppt0c17Wqz8iE';

function updateActualScanH9() {
  const targetSS = SpreadsheetApp.getActiveSpreadsheet();
  const recordSS = SpreadsheetApp.openById(H9_BARCODE_RECORD_SPREADSHEET_ID);

  // ไฟล์ชื่อ barcode record แต่ชื่อแท็บข้อมูลคือ Log
  const recordSheet = recordSS.getSheetByName('Log');
  const targetSheet = targetSS.getSheetByName('Plan');

  if (!recordSheet) {
    throw new Error('ไม่พบชีต "Log" ในไฟล์ Barcode Record');
  }

  if (!targetSheet) {
    throw new Error('ไม่พบชีต "Plan" ในไฟล์ลงยอด H9');
  }

  const recordData = recordSheet.getDataRange().getValues();
  const targetData = targetSheet.getDataRange().getValues();

  const countByJobOrderAndModel = {};
  // เวลาสแกน OK ทุกตัวของแต่ละ Job+รุ่น ใช้หาเวลาของสแกนตัวที่ทำให้ยอดครบแผน
  const scanTimesByKey = {};

  function makeKey(jobOrder, model) {
    return String(jobOrder).trim() + '|' + String(model).trim();
  }

  // Log:
  // A = Date/Time (เช่น "24/9/2569 10:46:12" ปีเป็น พ.ศ.)
  // B = Job Order
  // C = Model
  // E = Status
  for (let i = 1; i < recordData.length; i++) {
    const jobOrder = String(recordData[i][1]).trim(); // Column B
    const model = String(recordData[i][2]).trim();    // Column C
    const status = String(recordData[i][4]).trim().toUpperCase(); // Column E

    if (!jobOrder) continue;
    if (!model) continue;
    if (status !== 'OK') continue;

    const key = makeKey(jobOrder, model);
    countByJobOrderAndModel[key] = (countByJobOrderAndModel[key] || 0) + 1;

    const scanTime = parseLogDateTime(recordData[i][0]); // Column A
    if (scanTime) {
      if (!scanTimesByKey[key]) scanTimesByKey[key] = [];
      scanTimesByKey[key].push(scanTime);
    }
  }

  const actualScanValues = [];
  const statusValues = [];
  const completeDateValues = [];

  var planHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
  var statusColIdx = -1;
  for (var i = 0; i < planHeaders.length; i++) {
    var h = String(planHeaders[i]).toLowerCase().replace(/\s/g, '');
    if (h === "status" || h === "jobstatus" || h === "isclosed" || h === "สถานะ") {
      statusColIdx = i;
    }
  }
  // คอลัมน์ Actual complete date (ตรงชื่อเป๊ะ ไม่ใช่ "Actual complete date 0" ที่อยู่ข้าง ๆ)
  var completeDateColIdx = -1;
  for (var ci = 0; ci < planHeaders.length; ci++) {
    if (String(planHeaders[ci]).toLowerCase().replace(/\s/g, '') === 'actualcompletedate') {
      completeDateColIdx = ci;
    }
  }
  // ถ้ายังไม่พบคอลัมน์ Status ให้สร้างต่อท้าย
  if (statusColIdx === -1) {
    statusColIdx = planHeaders.length;
    targetSheet.getRange(1, statusColIdx + 1).setValue("Status");
  }

  // Plan:
  // D = Job Order (index 3)
  // G = Order model (index 6)
  // H = Plan Qty (index 7)
  // I = Actual Manual (index 8)
  // J = Actual Scan (index 9)
  for (let i = 1; i < targetData.length; i++) {
    const jobOrder = String(targetData[i][3]).trim(); // Column D
    const model = String(targetData[i][6]).trim();    // Column G
    const planQty = parseInt(targetData[i][7]) || 0;   // Column H
    const actualManual = parseInt(targetData[i][8]) || 0; // Column I
    const currentStatus = statusColIdx < targetData[i].length ? String(targetData[i][statusColIdx]).trim() : '';

    const currentCompleteDate = completeDateColIdx !== -1 && completeDateColIdx < targetData[i].length
      ? targetData[i][completeDateColIdx] : '';

    if (!jobOrder || !model) {
      actualScanValues.push(['']);
      statusValues.push([currentStatus]);
      completeDateValues.push([currentCompleteDate]);
      continue;
    }

    const key = makeKey(jobOrder, model);
    const actualScan = countByJobOrderAndModel[key] || 0;
    actualScanValues.push([actualScan]);

    // Actual complete date = เวลาของสแกนตัวที่ planQty (ตัวที่ทำให้ยอดสแกนครบออร์เดอร์)
    // สแกนยังไม่ครบแผน = "incomplete" เหมือนที่ชีตแสดงอยู่เดิม
    let completeDate = 'incomplete';
    if (planQty <= 0) {
      completeDate = '';
    } else if (actualScan >= planQty) {
      const times = (scanTimesByKey[key] || []).slice().sort(function (a, b) { return a - b; });
      completeDate = times.length >= planQty ? times[planQty - 1] : '';
    }
    completeDateValues.push([completeDate]);

    // ใช้ยอดที่สูงที่สุดระหว่าง ยอดแสกน และ ยอดแมนนวล เพื่อป้องกันการนับยอดซ้ำซ้อน
    const totalActual = Math.max(actualManual, actualScan);
    let newStatus = currentStatus;
    if (planQty > 0 && totalActual >= planQty && currentStatus !== 'Closed') {
      newStatus = 'Closed';
    }
    statusValues.push([newStatus]);
  }

  if (actualScanValues.length === 0) return;

  // เขียนทั้งคอลัมน์ J (Actual Scan) และ Status
  targetSheet.getRange(2, 10, actualScanValues.length, 1).setValues(actualScanValues);
  targetSheet.getRange(2, statusColIdx + 1, statusValues.length, 1).setValues(statusValues);

  if (completeDateColIdx !== -1) {
    const completeRange = targetSheet.getRange(2, completeDateColIdx + 1, completeDateValues.length, 1);
    completeRange.setValues(completeDateValues);
    completeRange.setNumberFormat('yyyy/mm/dd hh:mm');
  }
}

// แปลงค่า Date/Time ในแท็บ Log เป็น Date
// ปกติเป็นข้อความ "D/M/พ.ศ. HH:MM:SS" แต่ถ้า Sheets แปลงเป็นชนิดวันที่ไปแล้วก็ใช้ได้ตรง ๆ
function parseLogDateTime(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(value || '').trim());
  if (!m) return null;

  let year = Number(m[3]);
  if (year > 2400) year -= 543; // พ.ศ. -> ค.ศ.
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  return isNaN(d.getTime()) ? null : d;
}