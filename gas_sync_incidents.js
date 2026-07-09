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
    var sheetName = "Incidents";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(["ID", "Date", "Hour", "Line", "Model", "Category", "CategoryText", "Notes"]);
    }
    
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "SAVE";
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
