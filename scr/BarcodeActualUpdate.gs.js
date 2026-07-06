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

  // Plan:
  // D = Job Order
  // G = Order model
  // J = Actual Scan
  for (let i = 1; i < targetData.length; i++) {
    const jobOrder = String(targetData[i][3]).trim(); // Column D
    const model = String(targetData[i][6]).trim();    // Column G

    if (!jobOrder || !model) {
      actualScanValues.push(['']);
      continue;
    }

    const key = makeKey(jobOrder, model);
    const actualScan = countByJobOrderAndModel[key] || 0;

    actualScanValues.push([actualScan]);
  }

  if (actualScanValues.length === 0) return;

  // เขียนเฉพาะคอลัมน์ J เท่านั้น
  targetSheet.getRange(2, 10, actualScanValues.length, 1).setValues(actualScanValues);
}