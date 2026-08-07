var TARGET_SHEET_NAME = "ยอดผลิต"; // แก้ชื่อ Sheet ให้ตรงกับของคุณ

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Health check สำหรับตรวจว่า Deployment ที่แอปเรียกอยู่ยังใช้งานได้จริงหรือไม่
 * เรียกผ่าน URL /exec?mode=health แล้วจะเห็นว่าสคริปต์ผูกกับไฟล์ไหน เจอชีตเป้าหมายหรือเปล่า
 * ถ้าเปิดแล้วไม่เห็น JSON นี้ แปลว่าปัญหาอยู่ที่ URL หรือสิทธิ์ของ Deployment ไม่ใช่ที่โค้ด
 *
 * หมายเหตุ: ห้ามตั้งชื่อฟังก์ชันนี้ว่า doGet เพราะ Apps Script รวมทุกไฟล์ไว้ใน scope เดียวกัน
 * ถ้ามี doGet ซ้ำ ตัวที่โหลดทีหลังจะทับตัวแรก ทำให้เปิดเว็บแอปแล้วได้ JSON แทนหน้า index.html
 * ตัว doGet จริงอยู่ใน "บันทึก Plan.js" และจะเรียกฟังก์ชันนี้เมื่อมี ?mode=health
 */
function healthCheckPayload_() {
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName(TARGET_SHEET_NAME);
    return {
      result: "ok",
      spreadsheet: doc.getName(),
      targetSheet: TARGET_SHEET_NAME,
      targetSheetFound: !!sheet,
      lastRow: sheet ? sheet.getLastRow() : null,
      headers: sheet ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : null,
      allSheets: doc.getSheets().map(function (s) { return s.getName(); })
    };
  } catch (err) {
    return { result: "error", error: err.toString() };
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(10000);

  try {
    if (!hasLock) {
      return jsonOutput({ result: "error", error: "ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง" });
    }

    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName(TARGET_SHEET_NAME);
    // เดิม fallback ไป doc.getSheets()[0] เงียบ ๆ ทำให้ข้อมูลไปลงผิดแท็บโดยไม่มีใครรู้
    // ถ้าหาแท็บเป้าหมายไม่เจอ ให้แจ้ง error กลับไปแทนการเดา
    if (!sheet) {
      return jsonOutput({
        result: "error",
        error: 'ไม่พบชีตชื่อ "' + TARGET_SHEET_NAME + '" ในไฟล์ "' + doc.getName() +
               '" (แท็บที่มีอยู่: ' + doc.getSheets().map(function (s) { return s.getName(); }).join(', ') + ')'
      });
    }

    var data = JSON.parse(e.postData.contents);
    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();

    // ==========================================
    // ส่วนฟังก์ชัน ปิดจ๊อบ/เปิดจ๊อบ (Close/Re-open Job)
    // ==========================================
    if (data.action === 'close_job') {
      var planSheet = doc.getSheetByName("Plan");
      if (!planSheet) {
        return ContentService.createTextOutput(JSON.stringify({result: "error", error: "ไม่พบชีต Plan"})).setMimeType(ContentService.MimeType.JSON);
      }
      
      var planHeaders = planSheet.getRange(1, 1, 1, planSheet.getLastColumn()).getValues()[0];
      var jobColIdx = -1;
      var statusColIdx = -1;
      
      // ค้นหาคอลัมน์ Job Order และ Status ในชีต Plan
      for (var i = 0; i < planHeaders.length; i++) {
        var h = String(planHeaders[i]).toLowerCase().replace(/\s/g, '');
        if (h.includes("joborder") || h.includes("หมายเลขกำกับงาน") || h.includes("jobno")) {
          jobColIdx = i;
        }
        if (h === "status" || h === "jobstatus" || h === "isclosed" || h === "สถานะ") {
          statusColIdx = i;
        }
      }
      
      // ถ้าไม่พบคอลัมน์ Job Order ให้ใช้คอลัมน์ D (index 3) เป็นค่าเริ่มต้น
      if (jobColIdx === -1) jobColIdx = 3; 
      
      // ถ้าไม่พบคอลัมน์ Status ให้สร้างคอลัมน์ใหม่ที่ท้ายตาราง
      if (statusColIdx === -1) {
        statusColIdx = planHeaders.length;
        planSheet.getRange(1, statusColIdx + 1).setValue("Status");
      }
      
      var planRows = planSheet.getLastRow();
      var planValues = planSheet.getRange(2, jobColIdx + 1, planRows - 1, 1).getValues();
      var foundRow = -1;
      
      for (var r = 0; r < planValues.length; r++) {
        if (String(planValues[r][0]).trim() === String(data.jobNo).trim()) {
          foundRow = r + 2; // +2 เพราะ 1-indexed และข้ามหัวตาราง
          break;
        }
      }
      
      if (foundRow > -1) {
        var newStatusValue = data.isClosed === 'true' ? 'Closed' : 'Active';
        planSheet.getRange(foundRow, statusColIdx + 1).setValue(newStatusValue);
        return ContentService.createTextOutput(JSON.stringify({result: "success", row: foundRow, status: newStatusValue})).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({result: "error", error: "ไม่พบ Job No. ในชีต Plan"})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 1. อ่านหัวตาราง (บรรทัดที่ 1)
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // ==========================================
    // ส่วนฟังก์ชัน Undo (ยกเลิกลงยอด)
    // ==========================================
    if (data.action === 'undo') {
      var batchIdx = -1, jobNoIdx = -1, recorderIdx = -1, qtyIdx = -1;
      
      // หาตำแหน่ง Index ของคอลัมน์ที่ต้องการเทียบ
      for (var i = 0; i < headers.length; i++) {
        var header = String(headers[i]).toLowerCase().replace(/\s/g, '');
        if (header.includes("batch")) batchIdx = i;
        if (header.includes("joborder") || header.includes("หมายเลขกำกับงาน")) jobNoIdx = i;
        if (header.includes("recorder") || header.includes("ผู้บันทึก") || header.includes("ผู้กรอก")) recorderIdx = i;
        if (header.includes("fgqty") || header.includes("จำนวน")) qtyIdx = i;
      }

      if (lastRow > 1) {
        var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        
        // วนลูปจากล่างขึ้นบน เพื่อลบรายการล่าสุดที่ตรงกัน
        for (var r = values.length - 1; r >= 0; r--) {
          var rowBatch = batchIdx > -1 ? String(values[r][batchIdx]) : "";
          
          // ลบโดยใช้ Batch ID หากมีคอลัมน์ Batch ID และมีค่าส่งมา
          if (batchIdx > -1 && data.batchId) {
             if (rowBatch === String(data.batchId)) {
                sheet.deleteRow(r + 2); // +2 เพราะ r เริ่มที่ 0 และแถวข้อมูลจริงเริ่มที่ 2
                break;
             }
          } 
          // หากไม่มีคอลัมน์ Batch ID จะใช้ข้อมูล 3 อย่างเทียบกัน (Fallback)
          else if (jobNoIdx > -1) {
             var rowJob = String(values[r][jobNoIdx]);
             var rowRecorder = String(values[r][recorderIdx]).replace(/^'/, ''); 
             var rowQty = values[r][qtyIdx];
             if (rowJob === String(data.jobNo) && rowRecorder === String(data.recorder) && String(rowQty) === String(data.fgQty)) {
               sheet.deleteRow(r + 2);
               break; 
             }
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({result: "success_undo"})).setMimeType(ContentService.MimeType.JSON);
    }
    // ==========================================
    // จบส่วนฟังก์ชัน Undo
    // ==========================================

    // 2. อ่านสูตร R1C1 จากบรรทัดล่าสุดเตรียมไว้ (เพื่อก๊อปปี้ลงมา)
    var formulas = [];
    if (lastRow > 1) {
      formulas = sheet.getRange(lastRow, 1, 1, lastCol).getFormulasR1C1()[0];
    }

    var newRow = [];
    var formulasToSet = []; // ตัวเก็บสูตรที่จะใส่ทีหลัง

    // 3. วนลูปสร้างข้อมูลทีละคอลัมน์
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i]).toLowerCase().replace(/\s/g, '');
      var value = ""; 
      var isDataFilled = false; // ตัวเช็คว่าช่องนี้มีข้อมูลจาก App หรือไม่

      if (header.includes("timestamp") || header.includes("ประทับเวลา")) {
        value = new Date(); 
        isDataFilled = true;
      }
      else if (header.includes("batch")) {
        value = data.batchId; 
        isDataFilled = true;
      }
      else if (header.includes("recorder") || header.includes("ผู้บันทึก") || header.includes("ผู้กรอก")) { 
        value = "'" + data.recorder; isDataFilled = true;
      } 
      // ต้องเป็น || ไม่ใช่ && เพราะหัวคอลัมน์อาจเป็น "Date" หรือ "วันที่" อย่างใดอย่างหนึ่ง
      // ถ้าใช้ && แล้วหัวตารางไม่มีทั้งสองคำ ช่องวันที่จะถูกปล่อยว่าง ทำให้แถวนั้นหายจากหน้า Job Monitor
      else if (header.includes("date") || header.includes("วันที่")) {
        // --- เปลี่ยนประเภทให้เป็น วันที่ (Date Object) ---
        if (data.date && data.date.includes('-')) {
          var parts = data.date.split('-'); // YYYY-MM-DD
          // ใส่ year, month (ต้อง -1 เพราะเดือน JS เริ่มที่ 0), day
          value = new Date(parts[0], parts[1] - 1, parts[2]); 
        } else {
          value = data.date;
        }
        isDataFilled = true;
      }
      else if (header.includes("time") || header.includes("เวลา")) {
        value = "'" + data.time; isDataFilled = true;
      }
      else if (header.includes("shift") || header.includes("กะ") || header.includes("ช่วงเวลา")) {
        value = data.shift; isDataFilled = true;
      }
      else if (header.includes("joborder") || header.includes("หมายเลขกำกับงาน")) {
        value = data.jobNo; isDataFilled = true;
      }
      else if (header === "model") {
        value = data.model; isDataFilled = true;
      }
      else if (header.includes("fgqty") || header.includes("จำนวน")) {
        value = data.fgQty; isDataFilled = true;
      }
      else if (header.includes("modelchange") || header.includes("เปลี่ยนรุ่น")) {
        value = data.modelChange; isDataFilled = true;
      }
      else if (header.includes("remark") || header.includes("หมายเหตุ")) {
        value = data.remark; isDataFilled = true;
      }
      else if (header.includes("line")) {
        value = data.line; isDataFilled = true;
      }

      // ถ้าช่องนี้ไม่ได้ถูกเติมข้อมูลจาก App และต้นฉบับมีสูตร
      if (!isDataFilled && formulas[i] && formulas[i] !== "") {
        formulasToSet.push({col: i + 1, formula: formulas[i]});
        value = ""; // ปล่อยว่างไว้ก่อน
      }

      newRow.push(value);
    }

    // 4. บันทึกข้อมูล (Values) ลง Sheet
    sheet.appendRow(newRow);
    
    // 5. ตามไปใส่สูตรในแถวใหม่ที่เพิ่งสร้าง (ใช้ setFormulaR1C1 เพื่อความแม่นยำของสูตรอ้างอิงบรรทัด)
    var newRowIndex = sheet.getLastRow();
    if (formulasToSet.length > 0) {
      formulasToSet.forEach(function(item) {
        sheet.getRange(newRowIndex, item.col).setFormulaR1C1(item.formula);
      });
    }
    
    return ContentService.createTextOutput(JSON.stringify({result: "success"}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({result: "error", error: e.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (hasLock) lock.releaseLock();
  }
}