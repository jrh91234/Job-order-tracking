/**
 * Google Apps Script for syncing production incidents from Job Order Tracker dashboard to Google Sheets.
 *
 * !! DEPLOY THIS AS ITS OWN STANDALONE PROJECT — NEVER PASTE IT INTO THE PROJECT THAT SERVES
 * !! THE PRODUCTION-ENTRY PAGE (scr/ลงยอดผ่านแอป.js).
 *
 * Apps Script puts every file of a project in one shared scope, so two files each declaring
 * doPost do not conflict loudly: the one loaded last silently replaces the other. The
 * production-entry project already declares a doPost that writes the "ยอดผลิต" tab. Merging
 * this file into it makes every manual production entry hit the incident handler instead,
 * which appends a row holding only Date/Line/Model to the Incidents tab and drops the rest.
 *
 * รายละเอียดทั้งหมด (URL, ชื่อโปรเจกต์, วิธีหาโปรเจกต์เมื่อลืม, ประวัติปัญหา):
 * docs/apps-script-map.md
 *
 * Instructions:
 * 1. Go to script.google.com and create a NEW project (do not use Extensions -> Apps Script
 *    from inside the sheet, that opens the existing production-entry project)
 * 2. Paste this script and set SPREADSHEET_ID below to the target spreadsheet's ID
 * 3. Click Deploy -> New Deployment
 * 4. Choose "Web App" type
 * 5. Set "Execute as: Me" and "Who has access: Anyone"
 * 6. Click Deploy, authorize permissions, and copy the Web App URL
 * 7. Paste that URL into the "Apps Script URL สำหรับบันทึกเหตุการณ์" field of the Barcode
 *    Dashboard settings — it must differ from the production-entry web app URL
 */

// โปรเจกต์แยก (standalone) ไม่ได้ผูกกับชีตใดชีตหนึ่ง getActiveSpreadsheet() จึงคืนค่า null
// ต้องระบุ ID ของสเปรดชีตเป้าหมายตรงนี้ (ส่วนที่อยู่ระหว่าง /d/ กับ /edit ใน URL ของชีต)
// ค่านี้คือชีต "ลงยอด H9" ที่ใช้งานจริงอยู่ ถ้าย้ายไปชีตอื่นให้แก้ตรงนี้จุดเดียว
var SPREADSHEET_ID = "1PYcAatoJ4QX28uQ_LF8dDC6oTiMWbfPs5TZDfGJVa4U";

/**
 * เปิด URL ของ Web App ตัวนี้ในเบราว์เซอร์แล้วจะได้ JSON บอกว่านี่คือโปรเจกต์อะไร
 * ผูกกับชีตไหน และมีข้อมูลอยู่กี่แถว
 *
 * มีไว้เพื่อให้อีกหลายเดือนข้างหน้า เวลาเจอ URL นี้โดยจำไม่ได้แล้วว่าคืออะไร
 * จะตอบตัวเองได้ทันทีโดยไม่ต้องไล่เปิดโปรเจกต์ทีละอัน (ดู docs/apps-script-map.md)
 *
 * หมายเหตุ: ถ้าวันหนึ่งเอาไฟล์นี้ไปรวมกับโปรเจกต์ที่มี doGet อยู่แล้ว ต้องเปลี่ยนชื่อฟังก์ชันนี้
 * เพราะ Apps Script รวมทุกไฟล์ไว้ใน scope เดียว ตัวที่โหลดทีหลังจะทับตัวแรกเงียบ ๆ
 * แต่ทางที่ถูกคือ "อย่ารวม" ตั้งแต่แรก เพราะ doPost ก็จะทับกันด้วย
 */
function doGet(e) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var incidents = ss.getSheetByName("Incidents");
    var categories = ss.getSheetByName("IncidentCategories");
    return ContentService.createTextOutput(JSON.stringify({
      result: "ok",
      project: "Incident Sync (บันทึกเหตุการณ์และปัญหาผลิต)",
      purpose: "รับข้อมูลบันทึกเหตุการณ์จากหน้า barcode dashboard เขียนลงแท็บ Incidents",
      note: "นี่ไม่ใช่ Web App ของหน้าลงยอด ตัวนั้นเขียนแท็บ ยอดผลิต และเป็นคนละโปรเจกต์",
      docs: "docs/apps-script-map.md ในรีโป Job-order-tracking",
      spreadsheet: ss.getName(),
      spreadsheetId: SPREADSHEET_ID,
      incidentsSheetFound: !!incidents,
      incidentRows: incidents ? Math.max(0, incidents.getLastRow() - 1) : null,
      categoriesSheetFound: !!categories,
      allSheets: ss.getSheets().map(function (s) { return s.getName(); })
    }, null, 2)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      result: "error",
      error: err.toString(),
      hint: "ตรวจว่า SPREADSHEET_ID ถูกต้องและบัญชีที่ deploy มีสิทธิ์เข้าถึงชีตนั้น"
    }, null, 2)).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 10 seconds timeout

  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "SAVE";
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

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
    
    // --- MANPOWER OPERATIONS (กำลังคนรายไลน์ แยกตามกะ) ---
    // แยกแท็บของตัวเองเพราะเป็นคนละมิติกับบันทึกเหตุการณ์: 1 แถว = 1 วัน + 1 กะ + 1 ไลน์
    if (action === "GET_MANPOWER" || action === "SAVE_MANPOWER" || action === "DELETE_MANPOWER") {
      var mpName = "Manpower";
      var mpSheet = ss.getSheetByName(mpName);
      var MP_COLS = ["ID", "Date", "Shift", "Line",
                     "Assembler", "Feeder", "Leader", "Total",
                     "OTAssembler", "OTFeeder", "OTLeader", "OTTotal", "UpdatedAt"];
      if (!mpSheet) {
        mpSheet = ss.insertSheet(mpName);
        mpSheet.appendRow(MP_COLS);
      }

      var mpValues = mpSheet.getDataRange().getValues();

      if (action === "GET_MANPOWER") {
        var mpList = [];
        if (mpValues.length > 1) {
          var mpHeaders = mpValues[0];
          for (var r = 1; r < mpValues.length; r++) {
            var rec = {};
            for (var c = 0; c < mpHeaders.length; c++) rec[mpHeaders[c]] = mpValues[r][c];
            mpList.push(rec);
          }
        }
        return ContentService.createTextOutput(JSON.stringify({result: "success", manpower: mpList}))
                             .setMimeType(ContentService.MimeType.JSON);
      }

      if (!data.id) {
        return ContentService.createTextOutput(JSON.stringify({
          result: "ignored", message: "คำขอกำลังคนต้องมี id"
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var mpRow = -1;
      for (var r2 = 1; r2 < mpValues.length; r2++) {
        if (mpValues[r2][0] == data.id) { mpRow = r2 + 1; break; }
      }

      if (action === "DELETE_MANPOWER") {
        if (mpRow !== -1) mpSheet.deleteRow(mpRow);
        return ContentService.createTextOutput(JSON.stringify({result: "success", message: "Deleted"}))
                             .setMimeType(ContentService.MimeType.JSON);
      }

      var asm = Number(data.assembler) || 0;
      var fdr = Number(data.feeder) || 0;
      var ldr = Number(data.leader) || 0;
      // นำหน้าค่าที่เป็นข้อความด้วย ' เพื่อไม่ให้ Sheets แปลงชนิดเอง (บทเรียนจากคอลัมน์ Date และ Time)
      var otAsm = Number(data.otAssembler) || 0;
      var otFdr = Number(data.otFeeder) || 0;
      var otLdr = Number(data.otLeader) || 0;

      // เขียนตามชื่อคอลัมน์ในหัวตารางจริง ไม่ยึดตำแหน่งตายตัว
      // แท็บที่สร้างไว้ก่อนจะมีคอลัมน์ OT ยังใช้ต่อได้ โค้ดจะเติมหัวคอลัมน์ที่ขาดให้เอง
      // แถวเก่าจะเว้นว่างในคอลัมน์ใหม่ ไม่ถูกแตะต้อง (วิธีเดียวกับที่แท็บ Incidents ใช้)
      var mpHeaders = mpValues.length > 0 ? mpValues[0].slice() : [];
      var mpAdded = false;
      for (var mc = 0; mc < MP_COLS.length; mc++) {
        var wanted = MP_COLS[mc];
        var found = false;
        for (var mh = 0; mh < mpHeaders.length; mh++) {
          if (String(mpHeaders[mh]).trim() === wanted) { found = true; break; }
        }
        if (!found) { mpHeaders.push(wanted); mpAdded = true; }
      }
      if (mpAdded) {
        mpSheet.getRange(1, 1, 1, mpHeaders.length).setValues([mpHeaders]);
      }

      // นำหน้าค่าที่เป็นข้อความด้วย ' เพื่อไม่ให้ Sheets แปลงชนิดเอง
      var mpByCol = {
        "ID": data.id,
        "Date": data.date ? "'" + data.date : "",
        "Shift": data.shift ? "'" + data.shift : "",
        "Line": data.line ? "'" + data.line : "",
        "Assembler": asm,
        "Feeder": fdr,
        "Leader": ldr,
        "Total": asm + fdr + ldr,
        "OTAssembler": otAsm,
        "OTFeeder": otFdr,
        "OTLeader": otLdr,
        "OTTotal": otAsm + otFdr + otLdr,
        "UpdatedAt": "'" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm")
      };

      var mpData = [];
      for (var mk = 0; mk < mpHeaders.length; mk++) {
        var mkey = String(mpHeaders[mk]).trim();
        mpData.push(mpByCol.hasOwnProperty(mkey) ? mpByCol[mkey] : "");
      }

      if (mpRow !== -1) {
        mpSheet.getRange(mpRow, 1, 1, mpData.length).setValues([mpData]);
      } else {
        mpSheet.appendRow(mpData);
      }
      return ContentService.createTextOutput(JSON.stringify({result: "success", message: "Saved"}))
                           .setMimeType(ContentService.MimeType.JSON);
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
      // นำหน้าด้วย ' เพื่อบังคับให้ Sheets เก็บเป็นข้อความ ไม่แปลง "02:00" เป็นค่าชนิดเวลา
      // (ค่าชนิดเวลาจะถูกส่งกลับเป็น ISO ฐานปี 1899 แล้วแสดงผลเพี้ยน) getValues() จะไม่คืน ' ออกมา
      "Time": data.time ? "'" + data.time : ""
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
