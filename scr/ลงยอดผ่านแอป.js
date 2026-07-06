function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var sheetName = "ยอดผลิต"; // แก้ชื่อ Sheet ให้ตรงกับของคุณ
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName(sheetName);
    if (!sheet) sheet = doc.getSheets()[0];

    var data = JSON.parse(e.postData.contents);
    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();

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
      else if (header.includes("date") && header.includes("วันที่")) {
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
    lock.releaseLock();
  }
}