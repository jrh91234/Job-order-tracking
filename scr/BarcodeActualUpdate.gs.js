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

  function makeKey(jobOrder, model) {
    return String(jobOrder).trim() + '|' + String(model).trim();
  }

  // Log:
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
  }

  const actualScanValues = [];
  const statusValues = [];

  var planHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
  var statusColIdx = -1;
  for (var i = 0; i < planHeaders.length; i++) {
    var h = String(planHeaders[i]).toLowerCase().replace(/\s/g, '');
    if (h === "status" || h === "jobstatus" || h === "isclosed" || h === "สถานะ") {
      statusColIdx = i;
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

    if (!jobOrder || !model) {
      actualScanValues.push(['']);
      statusValues.push([currentStatus]);
      continue;
    }

    const key = makeKey(jobOrder, model);
    const actualScan = countByJobOrderAndModel[key] || 0;
    actualScanValues.push([actualScan]);

    // ถ้าผลรวม Actual (Manual) + Actual Scan ครบเป้าแล้ว ให้ปิดจ๊อบอัตโนมัติ
    const totalActual = actualManual + actualScan;
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
}