/**
 * เครื่องมือล้างแถวขยะในแท็บ Incidents
 *
 * ที่มาของแถวขยะ: Web App ของหน้าลงยอดกับของบันทึกเหตุการณ์เคยเป็นตัวเดียวกัน และ Apps Script
 * รวมทุกไฟล์ในโปรเจกต์ไว้ใน scope เดียว ทำให้ doPost ของบันทึกเหตุการณ์ทับ doPost ที่เขียนแท็บ
 * "ยอดผลิต" ทุก POST จากหน้าลงยอดจึงไหลมาเขียนแท็บ Incidents โดยเหลือแค่ Date/Line/Model
 *
 * บันทึกเหตุการณ์ของจริงจะมีคอลัมน์ ID เป็นคีย์รูปแบบ "YYYY-MM-DD_ชั่วโมง_ไลน์_รุ่น" เสมอ
 * สคริปต์นี้จึงใช้ "ID ว่าง" เป็นเงื่อนไขในการคัดแถวขยะออก
 *
 * วิธีใช้:
 * 1. เปิดโปรเจกต์ Apps Script ที่ผูกกับชีตนี้ (หรือสร้างโปรเจกต์ใหม่แล้วตั้ง SPREADSHEET_ID ด้านล่าง)
 * 2. วางไฟล์นี้เป็นไฟล์ใหม่ในโปรเจกต์
 * 3. รัน dryRunCleanupIncidents() ก่อนเสมอ แล้วดูผลใน "บันทึกการดำเนินการ (Execution log)"
 * 4. ถ้าตัวเลขถูกต้องแล้วค่อยรัน cleanupIncidents() ซึ่งจะสำรองแท็บให้อัตโนมัติก่อนลบ
 */

var CLEANUP_SPREADSHEET_ID = "1PYcAatoJ4QX28uQ_LF8dDC6oTiMWbfPs5TZDfGJVa4U";
var CLEANUP_SHEET_NAME = "Incidents";
var CLEANUP_ID_HEADER = "ID";

/**
 * อ่านสถานะแท็บ Incidents แล้วคืนรายการแถวที่เข้าข่ายเป็นแถวขยะ
 * ไม่แก้ไขข้อมูลใด ๆ ใช้ร่วมกันทั้ง dry run และตอนลบจริง เพื่อให้ทั้งสองโหมดตัดสินใจด้วยตรรกะเดียวกัน
 */
function findJunkIncidentRows_() {
  var ss = SpreadsheetApp.openById(CLEANUP_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CLEANUP_SHEET_NAME);
  if (!sheet) {
    throw new Error('ไม่พบแท็บ "' + CLEANUP_SHEET_NAME + '" ในไฟล์ "' + ss.getName() + '"');
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) {
    return { sheet: sheet, headers: [], idIndex: -1, junkRows: [], keptRows: [], totalRows: 0 };
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];

  // หาคอลัมน์ ID จากชื่อหัวตาราง ไม่ยึดตำแหน่งตายตัว เผื่อมีการสลับหรือแทรกคอลัมน์ในอนาคต
  var idIndex = -1;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).trim() === CLEANUP_ID_HEADER) { idIndex = c; break; }
  }
  if (idIndex === -1) {
    throw new Error('ไม่พบคอลัมน์ "' + CLEANUP_ID_HEADER + '" ในหัวตาราง จึงไม่สามารถแยกแถวขยะได้อย่างปลอดภัย');
  }

  var junkRows = [];
  var keptRows = [];
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][idIndex] || "").trim();
    var rowNumber = r + 1; // แถวจริงในชีตเริ่มนับที่ 1 และแถวแรกคือหัวตาราง
    if (id === "") {
      junkRows.push({ row: rowNumber, values: values[r] });
    } else {
      keptRows.push({ row: rowNumber, id: id });
    }
  }

  return {
    sheet: sheet,
    headers: headers,
    idIndex: idIndex,
    junkRows: junkRows,
    keptRows: keptRows,
    totalRows: values.length - 1
  };
}

/**
 * โหมดตรวจสอบ ไม่ลบอะไรทั้งสิ้น
 * รันตัวนี้ก่อนเสมอ แล้วอ่านผลใน Execution log เพื่อยืนยันว่าจำนวนและหน้าตาแถวตรงกับที่คาด
 */
function dryRunCleanupIncidents() {
  var info = findJunkIncidentRows_();

  Logger.log("=== DRY RUN — ไม่มีการแก้ไขข้อมูล ===");
  Logger.log("แท็บ: " + CLEANUP_SHEET_NAME + " | แถวข้อมูลทั้งหมด: " + info.totalRows);
  Logger.log("แถวที่จะถูกลบ (ID ว่าง): " + info.junkRows.length);
  Logger.log("แถวที่จะเก็บไว้ (มี ID): " + info.keptRows.length);

  Logger.log("");
  Logger.log("--- ตัวอย่างแถวที่จะถูกลบ (สูงสุด 15 แถวแรก) ---");
  for (var i = 0; i < Math.min(15, info.junkRows.length); i++) {
    Logger.log("  แถว " + info.junkRows[i].row + ": " + JSON.stringify(info.junkRows[i].values));
  }

  Logger.log("");
  Logger.log("--- แถวที่จะเก็บไว้ทั้งหมด ---");
  for (var k = 0; k < info.keptRows.length; k++) {
    Logger.log("  แถว " + info.keptRows[k].row + ": " + info.keptRows[k].id);
  }

  Logger.log("");
  Logger.log("ถ้าตัวเลขด้านบนถูกต้องแล้ว ให้รัน cleanupIncidents() เพื่อลบจริง");
  return {
    totalRows: info.totalRows,
    toDelete: info.junkRows.length,
    toKeep: info.keptRows.length
  };
}

/**
 * ลบแถวขยะจริง โดยสำรองแท็บทั้งอันไว้ก่อนเสมอ
 * ลบจากล่างขึ้นบนและรวมแถวที่ติดกันเป็นช่วงเดียว เพื่อไม่ให้เลขแถวเลื่อนระหว่างลบ
 */
function cleanupIncidents() {
  var info = findJunkIncidentRows_();

  if (info.junkRows.length === 0) {
    Logger.log("ไม่พบแถวขยะ ไม่มีอะไรต้องลบ");
    return { deleted: 0, backupSheet: null };
  }

  // สำรองก่อนลบ การลบแถวใน Apps Script ย้อนกลับไม่ได้ด้วยตัวเอง
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmm");
  var backupName = CLEANUP_SHEET_NAME + "_backup_" + stamp;
  var backup = info.sheet.copyTo(info.sheet.getParent()).setName(backupName);
  Logger.log("สำรองแท็บไว้แล้วที่: " + backupName);

  // รวมเลขแถวที่ติดกันเป็นช่วง แล้วลบจากล่างขึ้นบน
  var rows = info.junkRows.map(function (r) { return r.row; }).sort(function (a, b) { return a - b; });
  var ranges = [];
  var start = rows[0];
  var prev = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i] === prev + 1) {
      prev = rows[i];
    } else {
      ranges.push({ start: start, count: prev - start + 1 });
      start = rows[i];
      prev = rows[i];
    }
  }
  ranges.push({ start: start, count: prev - start + 1 });

  var deleted = 0;
  for (var j = ranges.length - 1; j >= 0; j--) {
    info.sheet.deleteRows(ranges[j].start, ranges[j].count);
    deleted += ranges[j].count;
  }

  Logger.log("ลบแถวขยะแล้ว " + deleted + " แถว | เหลือบันทึกเหตุการณ์ " + info.keptRows.length + " แถว");
  Logger.log('ถ้าผลลัพธ์ไม่ถูกต้อง ให้กู้จากแท็บสำรอง "' + backupName + '"');
  return { deleted: deleted, backupSheet: backupName, kept: info.keptRows.length };
}
