/**
 * Google Apps Script for syncing production incidents from Job Order Tracker dashboard to Google Sheets.
 * 
 * Instructions:
 * 1. Open your Google Sheet
 * 2. Go to Extensions -> Apps Script
 * 3. Replace all code in the editor with this script
 * 4. Click Deploy -> New Deployment
 * 5. Choose "Web App" type
 * 6. Set "Execute as: Me" and "Who has access: Anyone"
 * 7. Click Deploy, authorize permissions, and copy the Web App URL
 * 8. Paste the Web App URL in the Settings panel of the Barcode Dashboard
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 10 seconds timeout
  
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "SAVE";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- INCIDENT LOGS READ (GET_INCIDENTS) ---
    if (action === "GET_INCIDENTS") {
      var sheetName = "Incidents";
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({result: "success", incidents: []}))
                             .setMimeType(ContentService.MimeType.JSON);
      }
      var range = sheet.getDataRange();
      var values = range.getValues();
      var list = [];
      if (values.length > 1) {
        var headers = values[0];
        for (var i = 1; i < values.length; i++) {
          var row = {};
          for (var j = 0; j < headers.length; j++) {
            row[headers[j]] = values[i][j];
          }
          list.push(row);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({result: "success", incidents: list}))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- INCIDENT CATEGORIES OPERATIONS ---
    if (action === "GET_CATEGORIES" || action === "SAVE_CATEGORY" || action === "DELETE_CATEGORY") {
      var catSheetName = "IncidentCategories";
      var catSheet = ss.getSheetByName(catSheetName);
      if (!catSheet) {
        catSheet = ss.insertSheet(catSheetName);
        catSheet.appendRow(["Code", "Text"]);
        catSheet.appendRow(["Breakdown", "🛠️ เครื่องจักรขัดข้อง (Machine Breakdown)"]);
        catSheet.appendRow(["Material", "📦 วัตถุดิบขาดแคลน (Material Shortage)"]);
        catSheet.appendRow(["Changeover", "🔄 เปลี่ยนรุ่นล่าช้า (Model Changeover Delay)"]);
        catSheet.appendRow(["Operator", "👥 ปัญหาแรงงาน/พักเกินเวลา (Operator Issue)"]);
        catSheet.appendRow(["Other", "📝 อื่นๆ (ระบุบันทึกเพิ่มเติม)"]);
      }
      
      var catRange = catSheet.getDataRange();
      var catValues = catRange.getValues();
      
      if (action === "GET_CATEGORIES") {
        var list = [];
        for (var i = 1; i < catValues.length; i++) {
          list.push({ code: catValues[i][0], text: catValues[i][1] });
        }
        return ContentService.createTextOutput(JSON.stringify({result: "success", categories: list}))
                             .setMimeType(ContentService.MimeType.JSON);
      }
      
      if (action === "SAVE_CATEGORY") {
        var catCode = data.code;
        var catText = data.text;
        var catRowIndex = -1;
        for (var i = 1; i < catValues.length; i++) {
          if (catValues[i][0] == catCode) { catRowIndex = i + 1; break; }
        }
        if (catRowIndex !== -1) {
          catSheet.getRange(catRowIndex, 2).setValue(catText);
        } else {
          catSheet.appendRow([catCode, catText]);
        }
        return ContentService.createTextOutput(JSON.stringify({result: "success"}))
                             .setMimeType(ContentService.MimeType.JSON);
      }
      
      if (action === "DELETE_CATEGORY") {
        var catCode = data.code;
        var catRowIndex = -1;
        for (var i = 1; i < catValues.length; i++) {
          if (catValues[i][0] == catCode) { catRowIndex = i + 1; break; }
        }
        if (catRowIndex !== -1) {
          catSheet.deleteRow(catRowIndex);
        }
        return ContentService.createTextOutput(JSON.stringify({result: "success"}))
                             .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // --- INCIDENT LOGS OPERATIONS (WRITE/DELETE) ---
    // รับเฉพาะคำขอที่เป็นของบันทึกเหตุการณ์จริง ๆ เท่านั้น
    // การโพสต์จากหน้าลงยอด (index.html) ส่ง payload ที่ไม่มีฟิลด์ action มาด้วย
    // บรรทัด `data.action || "SAVE"` ด้านบนจึงตีความว่าเป็น SAVE แล้วไหลลงมาถึงตรงนี้
    // ผลคือทุกครั้งที่สแกนลงยอด จะมีแถวขยะ (มีแค่ Date/Line/Model ไม่มี ID) ถูก append ลงแท็บ Incidents
    // บันทึกเหตุการณ์ของจริงจะมี id เป็นคีย์รูปแบบ "YYYY-MM-DD_ชั่วโมง_ไลน์_รุ่น" เสมอ จึงใช้เป็นตัวคัดกรอง
    if ((action !== "SAVE" && action !== "DELETE") || !data.id) {
      return ContentService.createTextOutput(JSON.stringify({
        result: "ignored",
        message: "ไม่ใช่คำขอบันทึกเหตุการณ์ (ต้องมี action SAVE/DELETE และ id)"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var sheetName = "Incidents";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(["ID", "Date", "Hour", "Line", "Model", "JobOrder", "Category", "CategoryText", "Notes", "Time"]);
    }
    
    var id = data.id;
    var range = sheet.getDataRange();
    var values = range.getValues();
    var rowIndex = -1;
    
    // Search for existing row by ID
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] == id) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (action === "DELETE") {
      if (rowIndex !== -1) {
        sheet.deleteRow(rowIndex);
      }
      return ContentService.createTextOutput(JSON.stringify({result: "success", message: "Deleted"}))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // SAVE action
    // เขียนค่าโดยอิงชื่อคอลัมน์ในหัวตารางจริง ไม่ใช่ตำแหน่งตายตัว
    // ชีตเดิมมีแค่ 8 คอลัมน์ (ไม่มี JobOrder กับ Time) โค้ดนี้จะเติมหัวคอลัมน์ที่ขาดให้เอง
    // แถวเก่าที่มีอยู่แล้วจะเว้นว่างในคอลัมน์ใหม่ ไม่ถูกแตะต้อง
    var REQUIRED_COLS = ["ID", "Date", "Hour", "Line", "Model", "JobOrder", "Category", "CategoryText", "Notes", "Time"];
    var headers = values.length > 0 ? values[0].slice() : [];
    var added = false;
    for (var c = 0; c < REQUIRED_COLS.length; c++) {
      var name = REQUIRED_COLS[c];
      var found = false;
      for (var h = 0; h < headers.length; h++) {
        if (String(headers[h]).trim() === name) { found = true; break; }
      }
      if (!found) { headers.push(name); added = true; }
    }
    if (added) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    var valueByCol = {
      "ID": data.id,
      "Date": data.date,
      "Hour": data.hour,
      "Line": data.line,
      "Model": data.model || "All",
      "JobOrder": data.jobOrder || "",
      "Category": data.category,
      "CategoryText": data.categoryText,
      "Notes": data.notes,
      "Time": data.time || ""
    };

    var rowData = [];
    for (var k = 0; k < headers.length; k++) {
      var key = String(headers[k]).trim();
      rowData.push(valueByCol.hasOwnProperty(key) ? valueByCol[key] : "");
    }

    if (rowIndex !== -1) {
      // Update existing row
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Append new row
      sheet.appendRow(rowData);
    }
    
    return ContentService.createTextOutput(JSON.stringify({result: "success", message: "Saved"}))
                         .setMimeType(ContentService.MimeType.JSON);
                         
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({result: "error", message: err.toString()}))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
