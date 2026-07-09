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
    var sheetName = "Incidents";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(["ID", "Date", "Hour", "Line", "Model", "Category", "CategoryText", "Notes"]);
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
    var rowData = [
      data.id,
      data.date,
      data.hour,
      data.line,
      data.model || "All",
      data.category,
      data.categoryText,
      data.notes
    ];
    
    if (rowIndex !== -1) {
      // Update existing row
      sheet.getRange(rowIndex, 1, 1, 8).setValues([rowData]);
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
