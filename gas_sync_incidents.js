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

    // รายชื่อ action ที่โค้ดชุดนี้รองรับ เอาไว้ตอบคำถาม "deploy เวอร์ชันใหม่ขึ้นหรือยัง"
    // ถ้าเปิด URL แล้วไม่เห็น SAVE_SHIFT_TRANSFER แปลว่า URL นี้ยังเสิร์ฟโค้ดเก่าอยู่
    // (มักเกิดจากกด "การทำให้ใช้งานได้ใหม่" ซึ่งได้ URL ใหม่ ส่วน URL เดิมยังเป็นเวอร์ชันเก่า)
    var SUPPORTED_ACTIONS = [
      "GET_INCIDENTS", "SAVE", "DELETE",
      "GET_CATEGORIES", "SAVE_CATEGORY", "DELETE_CATEGORY",
      "GET_MANPOWER", "SAVE_MANPOWER", "DELETE_MANPOWER",
      "GET_SHIFT_TRANSFERS", "SAVE_SHIFT_TRANSFER", "DELETE_SHIFT_TRANSFER",
      "TRANSLATE"
    ];

    var rowsOf = function (name) {
      var sh = ss.getSheetByName(name);
      return sh ? Math.max(0, sh.getLastRow() - 1) : null;   // null = ยังไม่มีแท็บนี้
    };

    return ContentService.createTextOutput(JSON.stringify({
      result: "ok",
      project: "Incident Sync (บันทึกเหตุการณ์และปัญหาผลิต)",
      purpose: "รับข้อมูลจากหน้า barcode dashboard เขียนลงแท็บ Incidents, Manpower และ ShiftTransfers",
      note: "นี่ไม่ใช่ Web App ของหน้าลงยอด ตัวนั้นเขียนแท็บ ยอดผลิต และเป็นคนละโปรเจกต์",
      docs: "docs/apps-script-map.md ในรีโป Job-order-tracking",
      spreadsheet: ss.getName(),
      spreadsheetId: SPREADSHEET_ID,
      supportedActions: SUPPORTED_ACTIONS,
      // null = ยังไม่มีแท็บ (ปกติ ถ้ายังไม่เคยบันทึกอะไรลงไป) · ตัวเลข = จำนวนแถวข้อมูล
      rows: {
        Incidents: rowsOf("Incidents"),
        IncidentCategories: rowsOf("IncidentCategories"),
        Manpower: rowsOf("Manpower"),
        ShiftTransfers: rowsOf("ShiftTransfers"),
        IncidentDowntime: rowsOf("IncidentDowntime")
      },
      // AI สรุป Downtime: ต้องตั้ง trigger ให้ summarizeIncidentDowntimes ทุก 15 นาที และ Script property GEMINI_API_KEY
      downtimeAi: {
        geminiKeySet: !!PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY"),
        // ลำดับผู้ให้บริการที่ใช้ได้ (มี key ครบ) ตัวไหนโควตาเต็มจะข้ามไปตัวถัดไป
        providers: dtAiProviders_().map(function (pv) { return pv.id + " (" + pv.model + ", วันละ " + pv.maxPerDay + ")"; }),
        triggerNote: "ตั้ง Time-driven trigger ของ summarizeIncidentDowntimes ทุก 15 นาที (ดู docs/apps-script-map.md)"
      },
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

// Read-only integration with Maintenance-Management-System (ENC H9 only).
var MAINTENANCE_API_URL = 'https://script.google.com/macros/s/AKfycbwvqSh_1_VU_YLMI0fBWPa-B6IFXDDId1KIr6VYJAtsh0wUn6Jtln5ryJYR0luxqLc-Ew/exec';

function maintenanceJobsToIncidents_(jobs) {
  var seen = {};
  return jobs.reduce(function (out, job) {
    // ASSY also has numbered machines; never attribute them to H9 lines.
    if (job.book !== 'ENC' || !job.mtJob || seen[job.mtJob]) return out;
    var line = String(job.line || '').trim().match(/^(?:Line\s*)?(\d+)$/i);
    var timestamp = new Date(job.timestamp);
    if (!line || !job.timestamp || isNaN(timestamp.getTime())) return out;
    seen[job.mtJob] = true;
    var hour = Number(Utilities.formatDate(timestamp, 'Asia/Bangkok', 'H'));
    var time = Utilities.formatDate(timestamp, 'Asia/Bangkok', 'HH:mm');
    // Before 08:00 belongs to the previous production day.
    var productionDay = new Date(timestamp.getTime() - 8 * 60 * 60 * 1000);
    var date = Utilities.formatDate(productionDay, 'Asia/Bangkok', 'yyyy-MM-dd');
    out.push({
      ID: date + '_' + hour + '_maintenance_' + job.mtJob,
      Date: date, Hour: hour, Time: time, Line: String(Number(line[1])), Model: 'All',
      Shift: hour >= 8 && hour < 20 ? 'Day' : 'Night',
      Category: 'Breakdown', CategoryText: '🛠️ แจ้งซ่อม (Maintenance)',
      Notes: [job.mtJob, job.mc ? 'เครื่อง ' + job.mc : '', job.symptom,
        job.status ? 'สถานะ: ' + job.status : '',
        job.downtime !== '' && job.downtime != null ? 'หยุดเครื่อง: ' + job.downtime + ' นาที' : ''].filter(Boolean).join(' • '),
      Source: 'maintenance', SourceId: job.mtJob
    });
    return out;
  }, []);
}

/** Run once from the Apps Script editor as the deploying account to grant external-request access. */
function authorizeMaintenanceIntegration() {
  var incidents = fetchMaintenanceIncidents_(true);
  console.log('Maintenance integration OK: ' + incidents.length + ' incidents');
  return incidents.length;
}

// Aggregate-only attendance feed from HR Auto Organize; never returns employee data.
var ORGANIZE_API_URL = 'https://script.google.com/macros/s/AKfycbxYxBWD4blG_bP9hdTm_W8RP9PtM9CLZovmSFQVVsQTcBl18uxcaAxrhW5lZKFmEj8H/exec';

function fetchOrganizeAttendanceCounts_() {
  var response;
  try { response = UrlFetchApp.fetch(ORGANIZE_API_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({ action: 'getAttendanceCounts' }),
    muteHttpExceptions: true
  }); } catch (err) { throw new Error('ATTENDANCE_FETCH_FAILED'); }
  if (response.getResponseCode() !== 200) throw new Error('Attendance API HTTP ' + response.getResponseCode());
  var body;
  try { body = JSON.parse(response.getContentText()); }
  catch (err) { throw new Error('ATTENDANCE_NON_JSON_RESPONSE'); }
  if (body.status !== 'success' || !Array.isArray(body.groups) || !Number.isFinite(Number(body.total))) {
    throw new Error('Attendance API returned an invalid response');
  }
  return { date: body.date, scope: body.scope || { department: 'Assembly', team: 'H9' }, updatedAt: body.updatedAt, total: Number(body.total), groups: body.groups };
}

function fetchMaintenanceIncidents_(showOriginalError) {
  var response;
  try { response = UrlFetchApp.fetch(MAINTENANCE_API_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({ action: 'getBMJobs', payload: { area: 'ENC H9' } }),
    muteHttpExceptions: true
  }); } catch (err) {
    // Editor-only diagnostics: keep Google's original error for the owner.
    // Public API calls omit this flag and receive only a safe diagnostic code.
    if (showOriginalError === true) throw err;
    var message = String(err);
    if (/permission|authorization|scope|สิทธิ์/i.test(message)) throw new Error('MAINTENANCE_AUTHORIZATION_REQUIRED');
    throw new Error('MAINTENANCE_FETCH_FAILED');
  }
  if (response.getResponseCode() !== 200) throw new Error('Maintenance API HTTP ' + response.getResponseCode());
  var body;
  try { body = JSON.parse(response.getContentText()); }
  catch (err) { throw new Error('MAINTENANCE_NON_JSON_RESPONSE'); }
  if (!body.success || !Array.isArray(body.data)) throw new Error('Maintenance API returned an invalid response');
  return maintenanceJobsToIncidents_(body.data);
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
      var values = sheet ? sheet.getDataRange().getValues() : [];
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
      var attendanceSummary = null;
      var attendanceWarning = '';
      try { attendanceSummary = fetchOrganizeAttendanceCounts_(); }
      catch (attendanceErr) { attendanceWarning = 'โหลดจำนวนคนเช็คเข้างานไม่สำเร็จ'; console.warn(String(attendanceErr)); }
      var maintenanceWarning = '';
      var maintenanceError = '';
      try { list = list.concat(fetchMaintenanceIncidents_()); }
      catch (err) {
        maintenanceWarning = 'ดึงแจ้งซ่อมไม่สำเร็จ กรุณาลองโหลดใหม่';
        var reason = err && err.message ? String(err.message) : '';
        maintenanceError = /^(MAINTENANCE_[A-Z_]+|Maintenance API HTTP \d{3}|Maintenance API returned an invalid response)$/.test(reason) ? reason : 'MAINTENANCE_MAPPING_FAILED';
        console.warn(String(err));
      }
      var downtimeSummaries = [];
      try { downtimeSummaries = readDowntimeSummaries_(ss); } catch (dtErr) { console.warn(String(dtErr)); }
      return ContentService.createTextOutput(JSON.stringify({result: "success", incidents: list, downtimeSummaries: downtimeSummaries, maintenanceWarning: maintenanceWarning, maintenanceError: maintenanceError, attendanceSummary: attendanceSummary, attendanceWarning: attendanceWarning}))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- TRANSLATE (ไทย -> อังกฤษ ด้วย Gemini สำหรับรายงาน PDF ภาษาอังกฤษ) ---
    // ไม่แตะชีต ต้องตั้ง Script property ชื่อ GEMINI_API_KEY ก่อน
    // (Project Settings -> Script Properties) key จึงอยู่ฝั่งเซิร์ฟเวอร์ ไม่หลุดไปที่เบราว์เซอร์
    if (action === "TRANSLATE") {
      return ContentService.createTextOutput(JSON.stringify(translateWithGemini_(data.texts)))
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

    // --- SHIFT TRANSFER OPERATIONS (โอนยอดช่วงเวลาหนึ่งของไลน์เข้ากะที่ต้องการ) ---
    // ระบบตัดกะจากเลขชั่วโมงล้วน ๆ (20:00 เป็นต้นไป = กะดึกเสมอ) พอกะเช้าทำ OT ลากยาวถึง 22:00
    // ยอดชั่วโมง 20-21 จะถูกโยนไปกะดึกทั้งที่คนกะเช้าเป็นคนทำ แถวนี้ให้ผู้ใช้ระบุเองว่าช่วงไหนของไลน์ไหน
    // ต้องนับเข้ากะอะไร 1 แถว = 1 วัน + 1 ไลน์ + 1 ช่วงชั่วโมง
    if (action === "GET_SHIFT_TRANSFERS" || action === "SAVE_SHIFT_TRANSFER" || action === "DELETE_SHIFT_TRANSFER") {
      var stName = "ShiftTransfers";
      var stSheet = ss.getSheetByName(stName);
      var ST_COLS = ["ID", "Date", "Line", "FromHour", "ToHour", "TargetShift", "Note", "UpdatedAt"];
      if (!stSheet) {
        stSheet = ss.insertSheet(stName);
        stSheet.appendRow(ST_COLS);
      }

      var stValues = stSheet.getDataRange().getValues();

      if (action === "GET_SHIFT_TRANSFERS") {
        var stList = [];
        if (stValues.length > 1) {
          var stHeaders = stValues[0];
          for (var sr = 1; sr < stValues.length; sr++) {
            var stRec = {};
            for (var sc = 0; sc < stHeaders.length; sc++) stRec[stHeaders[sc]] = stValues[sr][sc];
            stList.push(stRec);
          }
        }
        return ContentService.createTextOutput(JSON.stringify({result: "success", transfers: stList}))
                             .setMimeType(ContentService.MimeType.JSON);
      }

      if (!data.id) {
        return ContentService.createTextOutput(JSON.stringify({
          result: "ignored", message: "คำขอโอนยอดเข้ากะต้องมี id"
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var stRow = -1;
      for (var sr2 = 1; sr2 < stValues.length; sr2++) {
        if (stValues[sr2][0] == data.id) { stRow = sr2 + 1; break; }
      }

      if (action === "DELETE_SHIFT_TRANSFER") {
        if (stRow !== -1) stSheet.deleteRow(stRow);
        return ContentService.createTextOutput(JSON.stringify({result: "success", message: "Deleted"}))
                             .setMimeType(ContentService.MimeType.JSON);
      }

      var stHeadersNow = stValues.length > 0 ? stValues[0].slice() : [];
      var stAdded = false;
      for (var stc = 0; stc < ST_COLS.length; stc++) {
        var stWanted = ST_COLS[stc];
        var stFound = false;
        for (var sth = 0; sth < stHeadersNow.length; sth++) {
          if (String(stHeadersNow[sth]).trim() === stWanted) { stFound = true; break; }
        }
        if (!stFound) { stHeadersNow.push(stWanted); stAdded = true; }
      }
      if (stAdded) stSheet.getRange(1, 1, 1, stHeadersNow.length).setValues([stHeadersNow]);

      var stByCol = {
        "ID": data.id,
        "Date": data.date ? "'" + data.date : "",
        "Line": data.line ? "'" + data.line : "",
        "FromHour": Number(data.fromHour) || 0,
        "ToHour": Number(data.toHour) || 0,
        "TargetShift": data.targetShift ? "'" + data.targetShift : "",
        "Note": data.note || "",
        "UpdatedAt": "'" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm")
      };

      var stData = [];
      for (var stk = 0; stk < stHeadersNow.length; stk++) {
        var stKey = String(stHeadersNow[stk]).trim();
        stData.push(stByCol.hasOwnProperty(stKey) ? stByCol[stKey] : "");
      }

      if (stRow !== -1) {
        stSheet.getRange(stRow, 1, 1, stData.length).setValues([stData]);
      } else {
        stSheet.appendRow(stData);
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
      sheet.appendRow(["ID", "Date", "Hour", "Line", "Model", "JobOrder", "Category", "CategoryText", "Notes", "Time", "Shift"]);
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
    var REQUIRED_COLS = ["ID", "Date", "Hour", "Line", "Model", "JobOrder", "Category", "CategoryText", "Notes", "Time", "Shift"];
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
      "Time": data.time ? "'" + data.time : "",
      // กะที่หน้าจอคำนวณไว้แล้ว เก็บไว้เพื่อให้ดูจากในชีตตรง ๆ ได้ว่าแถวไหนอยู่กะไหน
      // แถวเก่าที่ยังว่างอยู่ ฝั่งหน้าจอจะอนุมานจากคอลัมน์ Hour ให้เอง
      "Shift": data.shift === "Night" ? "Night" : data.shift === "Day" ? "Day" : ""
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


/**
 * แปลข้อความไทยเป็นอังกฤษด้วย Gemini คืนอาร์เรย์ผลแปลที่ลำดับตรงกับ texts
 * ถ้าจำนวนที่ได้กลับมาไม่ตรง จะถือว่าล้มเหลวทั้งชุดเพื่อไม่ให้คำแปลเลื่อนผิดตำแหน่ง
 */
function translateWithGemini_(texts) {
  var key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) return {result: "error", message: "ยังไม่ได้ตั้ง Script property GEMINI_API_KEY"};
  if (!texts || !texts.length) return {result: "success", translations: []};

  var prompt =
    "Translate each Thai string in the JSON array below into natural English for a factory production report " +
    "(terms: Job Order, Line, Model, Changeover, Manpower, OT, PCS, Eff%). " +
    "Keep numbers, model codes, job numbers, times and Latin text unchanged. " +
    "Return ONLY a JSON array of strings with exactly " + texts.length + " items in the same order.\n\n" +
    JSON.stringify(texts);

  var res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "post",
      contentType: "application/json",
      headers: {"x-goog-api-key": key},
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {responseMimeType: "application/json", temperature: 0}
      })
    }
  );
  if (res.getResponseCode() !== 200) {
    return {result: "error", message: "Gemini HTTP " + res.getResponseCode()};
  }
  try {
    var body = JSON.parse(res.getContentText());
    var out = JSON.parse(body.candidates[0].content.parts[0].text);
    if (!Array.isArray(out) || out.length !== texts.length) {
      return {result: "error", message: "Gemini returned a mismatched number of items"};
    }
    return {result: "success", translations: out.map(String)};
  } catch (err) {
    return {result: "error", message: "Cannot parse Gemini response: " + err};
  }
}

// =====================================================================
// AI สรุป Downtime ของแต่ละเหตุการณ์ (แท็บ IncidentDowntime)
// =====================================================================
// ทำงานเป็นรอบด้วย time-driven trigger (ตั้งเองครั้งเดียวในหน้า Triggers ของโปรเจกต์นี้
// ให้เรียก summarizeIncidentDowntimes ทุก 15 นาที ดู docs/apps-script-map.md)
// ไม่ได้สร้าง trigger จากโค้ด เพราะต้องเพิ่ม scope script.scriptapp ซึ่งทำให้ Web App
// ใช้งานไม่ได้จนกว่าเจ้าของจะกดอนุญาตใหม่
//
// ขั้นตอนต่อหนึ่งรอบ
//   1) หาเหตุการณ์ (บันทึกเอง + แจ้งซ่อม) ที่แจ้งมาแล้วเกิน DOWNTIME_WAIT_MIN นาที และยังไม่มีผล
//      หรือผลเดิมคิดจากข้อมูลเหตุการณ์ชุดเก่า (แก้เวลา/ไลน์/ข้อความภายหลัง)
//   2) อ่านสแกนจากชีตบาร์โค้ด แล้วคำนวณช่วงหยุดสแกนของไลน์นั้นรอบเวลาที่แจ้ง
//   3) ส่งข้อความที่แจ้ง + ช่วงหยุดให้ Gemini เลือกช่วงที่เป็นของปัญหานี้ (ทีละ วัน/กะ/ไลน์
//      เพื่อให้หลายเหตุการณ์ในช่วงเดียวกันแบ่งเวลากันได้ ไม่นับซ้ำ)
//   4) บันทึกผลลงแท็บ IncidentDowntime หน้า dashboard ใช้ค่านี้แทนกติกาจากสแกน

var BARCODE_SPREADSHEET_ID = '1OX5aKM-TuJPJIT_7v3Lq5WcvixxUo3ppt0c17Wqz8iE';
var BARCODE_SHEET_GID = 0;
var DOWNTIME_TAB = 'IncidentDowntime';
var DOWNTIME_COLS = ['Key', 'ID', 'Line', 'Date', 'Minutes', 'Start', 'End', 'Confidence', 'Reason', 'Sig', 'By', 'UpdatedAt'];
var DOWNTIME_WAIT_MIN = 60;            // รอให้เหตุการณ์ผ่านไปก่อน จะได้เห็นว่าไลน์กลับมาเดินเมื่อไหร่
var DOWNTIME_LOOKBACK_DAYS = 7;        // ไม่ย้อนสรุปเหตุการณ์ที่เก่ากว่านี้ (Gemini แผนฟรีได้วันละไม่กี่ครั้ง ย้อนไกลไม่ไหว)
var DOWNTIME_WINDOW_MIN = 120;         // ส่งช่วงหยุดสแกนรอบเวลาที่แจ้ง ± กี่นาทีให้ AI ดู
var DOWNTIME_MIN_GAP_MIN = 3;          // ช่องว่างระหว่างสแกนที่สั้นกว่านี้ถือว่าไลน์ยังเดินปกติ
// โควตา Gemini แผนฟรี (ดูจาก AI Studio → Rate limits): gemini-2.5-flash ได้แค่ 5 ครั้ง/นาที 20 ครั้ง/วัน
// และใช้ร่วมกับการแปลรายงาน PDF จึงแยกไปใช้โมเดล Flash-Lite ซึ่งมีโควตาของตัวเอง
// เปลี่ยนโมเดล/เพดานได้ใน Script properties โดยไม่ต้องแก้โค้ด: GEMINI_DOWNTIME_MODEL, DOWNTIME_AI_MAX_PER_DAY
var DOWNTIME_AI_DEFAULT_MODEL = 'gemini-2.5-flash-lite';
var DOWNTIME_AI_DEFAULT_MAX_PER_DAY = 20;  // นับเฉพาะครั้งที่เรียก AI จริง เกินแล้วรอวันถัดไป
var DOWNTIME_AI_MAX_CALLS_PER_RUN = 4;     // รอบละไม่เกิน 4 ครั้ง เว้นระยะ 13 วินาที → ไม่เกิน 5 ครั้ง/นาที
var DOWNTIME_AI_CALL_GAP_MS = 13000;
var DT_BREAK_MINUTES_BY_HOUR = {0: 60, 5: 30, 12: 60, 17: 30}; // ตรงกับ BREAK_MINUTES_BY_HOUR ในหน้าเว็บ

function dtPad_(n) { return (n < 10 ? '0' : '') + n; }

/** วันผลิต "yyyy-MM-dd" + "HH:mm" -> เวลาจริง (00:00-07:59 เป็นกะดึกของวันผลิตก่อนหน้า จึงเลื่อนไปวันถัดไป) */
function dtIncidentTs_(date, hhmm) {
  var d = String(date).split('-').map(Number);
  var t = String(hhmm).split(':').map(Number);
  if (d.length < 3 || isNaN(t[0])) return NaN;
  return new Date(d[0], d[1] - 1, d[2] + (t[0] < 8 ? 1 : 0), t[0], t[1] || 0, 0, 0).getTime();
}

function dtFormatHm_(ts) {
  var d = new Date(ts);
  return dtPad_(d.getHours()) + ':' + dtPad_(d.getMinutes());
}

/** ช่วงเวลาของกะที่เวลาแจ้งตกอยู่: เริ่มกะ, เลิกงานปกติ (สุทธิ 8 ชม. + พัก 1 ชม.), สิ้นกะรวม OT */
function dtShiftWindow_(date, hour) {
  var night = hour < 8 || hour >= 20;
  var d = String(date).split('-').map(Number);
  var start = new Date(d[0], d[1] - 1, d[2], night ? 20 : 8, 0, 0, 0).getTime();
  return {night: night, start: start, normalEnd: start + 9 * 3600000, end: start + 12 * 3600000};
}

function dtBreakOverlapMs_(fromMs, toMs) {
  if (!(toMs > fromMs)) return 0;
  var overlap = 0;
  var day = new Date(fromMs); day.setHours(0, 0, 0, 0);
  for (var d = day.getTime(); d < toMs; ) {
    Object.keys(DT_BREAK_MINUTES_BY_HOUR).forEach(function (h) {
      var b = new Date(d); b.setHours(Number(h), 0, 0, 0);
      var lo = Math.max(fromMs, b.getTime());
      var hi = Math.min(toMs, b.getTime() + DT_BREAK_MINUTES_BY_HOUR[h] * 60000);
      if (hi > lo) overlap += hi - lo;
    });
    var next = new Date(d); next.setDate(next.getDate() + 1); d = next.getTime();
  }
  return overlap;
}

/** แถวเหตุการณ์ (จากแท็บ Incidents หรือจากระบบแจ้งซ่อม) -> รูปแบบเดียวกัน ข้ามแถวที่ข้อมูลไม่ครบ */
function dtNormalizeIncident_(row) {
  if (!row || !row.ID) return null;
  var tz = Session.getScriptTimeZone();
  var date = row.Date instanceof Date ? Utilities.formatDate(row.Date, tz, 'yyyy-MM-dd') : String(row.Date || '').replace(/^'/, '').trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m) return null;
  date = m[1] + '-' + dtPad_(Number(m[2])) + '-' + dtPad_(Number(m[3]));
  var time = row.Time instanceof Date ? Utilities.formatDate(row.Time, tz, 'HH:mm') : String(row.Time || '').replace(/^'/, '').trim();
  var tm = /^(\d{1,2}):(\d{2})/.exec(time);
  var hour = tm ? Number(tm[1]) : parseInt(row.Hour, 10);
  if (isNaN(hour) || hour < 0 || hour > 23) return null;
  time = dtPad_(hour) + ':' + (tm ? tm[2] : '00');
  return {
    id: String(row.ID), date: date, time: time, hour: hour,
    line: String(row.Line == null ? '' : row.Line).trim() || 'All',
    category: String(row.Category || ''), categoryText: String(row.CategoryText || row.Category || ''),
    notes: String(row.Notes || ''), source: String(row.Source || 'manual')
  };
}

/** ลายเซ็นของข้อมูลเหตุการณ์ ถ้าเปลี่ยน (แก้เวลา/ไลน์/ข้อความ) ต้องสรุปใหม่ */
function dtSig_(inc) {
  return [inc.date, inc.time, inc.line, inc.category, inc.notes].join('|');
}

/** "3/11/2569 10:19:00" (วัน/เดือน/ปี พ.ศ.) หรือ Date -> ms */
function dtParseScanTs_(value) {
  if (value instanceof Date) {
    var y = value.getFullYear();
    // ชีตอาจแปลงข้อความ พ.ศ. เป็นวันที่เองโดยไม่ลบ 543
    if (y > 2400) { var c = new Date(value.getTime()); c.setFullYear(y - 543); return c.getTime(); }
    return value.getTime();
  }
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value || '').trim());
  if (!m) return NaN;
  var year = Number(m[3]); if (year > 2400) year -= 543;
  return new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
}

/** สแกน OK ทั้งหมดจากชีตบาร์โค้ดตั้งแต่ sinceTs แยกตามไลน์ เรียงตามเวลา */
function dtReadScansByLine_(sinceTs) {
  var ss = SpreadsheetApp.openById(BARCODE_SPREADSHEET_ID);
  var sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === BARCODE_SHEET_GID; })[0] || ss.getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var iTime = head.indexOf('Date/Time'), iStatus = head.indexOf('Status'), iLine = head.indexOf('Line'), iModel = head.indexOf('Model');
  var byLine = {};
  for (var r = 1; r < values.length; r++) {
    var status = String(values[r][iStatus] || 'OK').trim().toUpperCase();
    if (status !== 'OK') continue;
    var ts = dtParseScanTs_(values[r][iTime]);
    if (isNaN(ts) || ts < sinceTs) continue;
    var line = String(values[r][iLine] == null ? '' : values[r][iLine]).trim();
    if (!line || line === '-') continue;
    (byLine[line] = byLine[line] || []).push({ts: ts, model: String(values[r][iModel] || '')});
  }
  Object.keys(byLine).forEach(function (l) { byLine[l].sort(function (a, b) { return a.ts - b.ts; }); });
  return byLine;
}

/** ไลน์ที่เหตุการณ์ "ทุกไลน์" ครอบ: ไลน์ที่มีสแกนในระยะ ±60 นาทีรอบเวลาที่แจ้ง (ถ้าไม่มี ใช้ไลน์ที่เดินในกะนั้น) */
function dtLinesForIncident_(inc, scansByLine, win) {
  if (inc.line !== 'All') return [inc.line];
  var reportTs = dtIncidentTs_(inc.date, inc.time);
  var has = function (from, to) {
    return Object.keys(scansByLine).filter(function (l) {
      return scansByLine[l].some(function (s) { return s.ts >= from && s.ts < to; });
    });
  };
  var lines = has(Math.max(win.start, reportTs - 3600000), Math.min(win.end, reportTs + 3600000));
  return lines.length ? lines : has(win.start, win.end);
}

/**
 * ช่วงหยุดสแกนของไลน์หนึ่งในกะหนึ่ง เฉพาะที่ทับช่วง [fromTs, toTs]
 * คืน {workEnd, hasOT, gaps:[{start,end,minutes,breakMinutes,kind}]}
 * kind: shift_start = ต้นกะยังไม่สแกน · gap = หยุดระหว่างสแกน · no_resume = ไม่กลับมาสแกน · no_production = ไม่มีสแกนทั้งกะ
 */
function dtScanGaps_(scans, win, fromTs, toTs, nowMs) {
  var inShift = scans.filter(function (s) { return s.ts >= win.start && s.ts < win.end; });
  var hasOT = inShift.some(function (s) { return s.ts >= win.normalEnd; });
  var workEnd = Math.min(hasOT ? win.end : win.normalEnd, nowMs);
  var gaps = [];
  var push = function (a, b, kind) {
    if (!(b > a) || b <= fromTs || a >= toTs) return;
    var minutes = (b - a) / 60000;
    if (kind === 'gap' && minutes < DOWNTIME_MIN_GAP_MIN) return;
    gaps.push({start: a, end: b, minutes: Math.round(minutes), breakMinutes: Math.round(dtBreakOverlapMs_(a, b) / 60000), kind: kind});
  };
  if (inShift.length === 0) { push(win.start, workEnd, 'no_production'); return {workEnd: workEnd, hasOT: hasOT, gaps: gaps}; }
  push(win.start, inShift[0].ts, 'shift_start');
  for (var i = 1; i < inShift.length; i++) push(inShift[i - 1].ts, inShift[i].ts, 'gap');
  push(inShift[inShift.length - 1].ts, workEnd, 'no_resume');
  return {workEnd: workEnd, hasOT: hasOT, gaps: gaps};
}

/** ข้อความที่ส่งให้ Gemini สำหรับเหตุการณ์ทุกรายการของ วัน/กะ/ไลน์ เดียวกัน */
function dtBuildPrompt_(group) {
  var win = group.win;
  var payload = {
    line: group.line,
    productionDate: group.date,
    shift: win.night ? 'Night 20:00-08:00' : 'Day 08:00-20:00',
    normalWorkEnd: dtFormatHm_(win.normalEnd),
    workedOvertime: group.ctx.hasOT,
    countUntil: dtFormatHm_(group.ctx.workEnd),
    breaks: win.night ? ['00:00-01:00', '05:00-05:30'] : ['12:00-13:00', '17:00-17:30'],
    scanStops: group.ctx.gaps.map(function (g) {
      return {from: dtFormatHm_(g.start), to: dtFormatHm_(g.end), minutes: g.minutes, breakMinutesInside: g.breakMinutes, kind: g.kind};
    }),
    incidents: group.items.map(function (inc) {
      return {id: inc.id, reportedAt: inc.time, category: inc.categoryText || inc.category, notes: inc.notes, source: inc.source, allLines: inc.line === 'All'};
    })
  };
  return [
    'คุณช่วยสรุปเวลาที่ไลน์ผลิตหยุด (downtime) ของแต่ละเหตุการณ์ที่หน้างานแจ้ง โดยดูจากข้อความที่แจ้งและช่วงที่ไลน์หยุดสแกนงาน',
    'กติกา:',
    '- scanStops คือช่วงที่ไลน์ไม่มีสแกนชิ้นงาน (from/to เป็นเวลา HH:mm) kind: shift_start = ต้นกะยังไม่เริ่มสแกน, gap = หยุดกลางกะ (มีสแกนก่อนและหลัง), no_resume = ไม่กลับมาสแกนจนเลิกงาน, no_production = ไม่มีสแกนทั้งกะ',
    '- เลือกช่วงหยุดที่เกิดจากปัญหาที่แจ้งจริง เวลาที่แจ้งอาจช้ากว่าเวลาที่หยุดจริง (แจ้งหลังหยุด) หรือแจ้งก่อนหยุดก็ได้ ให้ดูความสอดคล้องกับข้อความ',
    '- ถ้าข้อความระบุระยะเวลาหรือเวลาที่ของมา/กลับมาเดิน (เช่น "รอเบิก 13 นาที", "Box มาตอน 21:03", "หยุดเครื่อง: 12 นาที") ให้ใช้ข้อมูลนั้นประกอบกับช่วงหยุดสแกน',
    '- ต้นกะมักมี morning talk/เตรียมงาน ห้ามนับช่วง shift_start เป็นเวลาที่เสียจากปัญหา เว้นแต่ข้อความบอกชัดว่าปัญหาทำให้เริ่มงานไม่ได้ (เช่น ไม่มีวัตถุดิบตั้งแต่ต้นกะ)',
    '- ถ้าไลน์ยังสแกนต่อเนื่องและข้อความไม่บอกระยะเวลา ให้ downtime = 0',
    '- หลายเหตุการณ์ในช่วงหยุดเดียวกันต้องแบ่งเวลากัน ห้ามนับเวลาเดียวกันซ้ำ',
    '- ไม่นับเวลาพัก (breaks) และไม่นับหลังเวลา countUntil',
    'ตอบเป็น JSON array เท่านั้น 1 รายการต่อ 1 เหตุการณ์ ตามลำดับเดิม:',
    '[{"id": "...", "start": "HH:mm" หรือ null, "end": "HH:mm" หรือ null, "minutes": จำนวนนาทีที่เสีย (ไม่รวมพัก), "confidence": "high"|"medium"|"low", "reason": "เหตุผลสั้น ๆ ภาษาไทย ไม่เกิน 120 ตัวอักษร"}]',
    '',
    JSON.stringify(payload)
  ].join('\n');
}

/**
 * ผู้ให้บริการ AI ที่ใช้สรุป Downtime เรียงตามลำดับที่จะลองใช้ ตัวไหนโควตาเต็ม (HTTP 429) หรือใช้ครบเพดาน
 * ของวันแล้ว ข้ามไปตัวถัดไป ตัวที่ยังไม่ได้ตั้ง key (และชื่อโมเดล สำหรับ Groq/OpenAI) ใน Script properties จะไม่ถูกใช้
 *   1) Gemini Flash-Lite (GEMINI_API_KEY) โควตาแยกจากที่ใช้แปลรายงาน PDF
 *   2) Gemini 2.5 Flash (GEMINI_API_KEY) ใช้แค่วันละ 5 ครั้ง เหลือโควตาไว้ให้การแปลรายงาน PDF
 *   3) Groq (GROQ_API_KEY; GROQ_MODEL ไม่ใส่ = llama-3.3-70b-versatile) มีแผนฟรี
 *   4) Claude (ANTHROPIC_API_KEY) เสียเงินตามการใช้งาน
 *   5) OpenAI (OPENAI_API_KEY + OPENAI_MODEL) เสียเงินตามการใช้งาน
 */
function dtAiProviders_() {
  var p = PropertiesService.getScriptProperties();
  var get = function (k) { return p.getProperty(k) || ''; };
  var list = [
    {id: 'gemini-lite', type: 'gemini', key: get('GEMINI_API_KEY'), model: get('GEMINI_DOWNTIME_MODEL') || DOWNTIME_AI_DEFAULT_MODEL,
      maxPerDay: Number(get('DOWNTIME_AI_MAX_PER_DAY')) || DOWNTIME_AI_DEFAULT_MAX_PER_DAY},
    {id: 'gemini-flash', type: 'gemini', key: get('GEMINI_API_KEY'), model: 'gemini-2.5-flash', maxPerDay: 5},
    {id: 'groq', type: 'openai', key: get('GROQ_API_KEY'), model: get('GROQ_MODEL') || 'llama-3.3-70b-versatile',
      url: 'https://api.groq.com/openai/v1/chat/completions', maxPerDay: Number(get('GROQ_MAX_PER_DAY')) || 100},
    {id: 'claude', type: 'anthropic', key: get('ANTHROPIC_API_KEY'), model: get('ANTHROPIC_DOWNTIME_MODEL') || 'claude-opus-5-5',
      maxPerDay: Number(get('ANTHROPIC_MAX_PER_DAY')) || 50},
    {id: 'openai', type: 'openai', key: get('OPENAI_API_KEY'), model: get('OPENAI_MODEL'),
      url: 'https://api.openai.com/v1/chat/completions', maxPerDay: Number(get('OPENAI_MAX_PER_DAY')) || 50}
  ];
  return list.filter(function (x, i) {
    if (!x.key || !x.model) return false;
    // ถ้าตั้งให้ตัวแรกใช้ gemini-2.5-flash อยู่แล้ว ไม่ต้องมีตัวที่สองซ้ำ
    return !(i > 0 && x.type === 'gemini' && x.model === list[0].model);
  });
}

/** ตัวนับการใช้และสถานะ "โควตาเต็ม" ของแต่ละผู้ให้บริการ แยกตามวัน เก็บใน Script properties */
function dtAiUsage_() {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var cnt = function (pv) { return 'downtime_ai_calls_' + pv.id + '_' + day; };
  var full = function (pv) { return 'downtime_ai_full_' + pv.id + '_' + day; };
  return {
    available: function (pv) {
      return !props.getProperty(full(pv)) && (Number(props.getProperty(cnt(pv))) || 0) < pv.maxPerDay;
    },
    use: function (pv) { props.setProperty(cnt(pv), String((Number(props.getProperty(cnt(pv))) || 0) + 1)); },
    markFull: function (pv) { props.setProperty(full(pv), '1'); }
  };
}

/** ดึง JSON array จากข้อความตอบกลับ (บางเจ้าอาจห่อด้วย ```json หรือมีคำอธิบายนำหน้า) */
function dtParseJsonArray_(text) {
  var t = String(text || '').trim();
  var a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a === -1 || b <= a) throw new Error('AI did not return a JSON array');
  var out = JSON.parse(t.slice(a, b + 1));
  if (!Array.isArray(out)) throw new Error('AI did not return a JSON array');
  return out;
}

/** เรียกผู้ให้บริการหนึ่งเจ้า คืนข้อความที่ตอบกลับ หรือโยน error (มี status เมื่อเป็น HTTP error) */
function dtCallProvider_(pv, prompt) {
  var res, body;
  if (pv.type === 'gemini') {
    res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(pv.model) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: {'x-goog-api-key': pv.key}, muteHttpExceptions: true,
      payload: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0}})
    });
  } else if (pv.type === 'anthropic') {
    var req = {model: pv.model, max_tokens: 16000, output_config: {effort: 'low'}, messages: [{role: 'user', content: prompt}]};
    var headers = {'x-api-key': pv.key, 'anthropic-version': '2026-10-21'};
    // โมเดลระดับบนอาจปฏิเสธคำขอด้วย safety classifier ให้ Anthropic ส่งต่อไปโมเดลสำรองเองฝั่งเซิร์ฟเวอร์
    if (/^claude-(opus-5|fable-5|sonnet-5-5)/.test(pv.model)) {
      req.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', headers: headers, muteHttpExceptions: true, payload: JSON.stringify(req)
    });
  } else {
    res = UrlFetchApp.fetch(pv.url, {
      method: 'post', contentType: 'application/json', headers: {Authorization: 'Bearer ' + pv.key}, muteHttpExceptions: true,
      payload: JSON.stringify({model: pv.model, temperature: 0, messages: [{role: 'user', content: prompt}]})
    });
  }
  var code = res.getResponseCode();
  if (code !== 200) { var e = new Error(pv.id + ' HTTP ' + code + ' (' + pv.model + ')'); e.status = code; throw e; }
  body = JSON.parse(res.getContentText());
  if (pv.type === 'gemini') return body.candidates[0].content.parts[0].text;
  if (pv.type === 'anthropic') {
    if (body.stop_reason === 'refusal') throw new Error('claude refused the request');
    return (body.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  }
  return body.choices[0].message.content;
}

/**
 * ลองทีละผู้ให้บริการจนได้คำตอบ ตัวที่ตอบ 429 ถือว่าโควตาวันนี้เต็ม ข้ามไปทั้งวัน
 * คืน {answers, provider} หรือ null ถ้าไม่มีเจ้าไหนใช้ได้แล้ววันนี้ (รอวันถัดไป) โยน error ถ้าทุกเจ้าที่ลองล้มเหลวด้วยเหตุอื่น
 */
function dtCallAi_(prompt, usage) {
  var providers = dtAiProviders_();
  if (!providers.length) throw new Error('ยังไม่ได้ตั้ง API key ของ AI ใน Script properties (อย่างน้อย GEMINI_API_KEY)');
  var lastErr = null, tried = false;
  for (var i = 0; i < providers.length; i++) {
    var pv = providers[i];
    if (!usage.available(pv)) continue;
    tried = true;
    usage.use(pv);
    try {
      return {answers: dtParseJsonArray_(dtCallProvider_(pv, prompt)), provider: pv.id};
    } catch (err) {
      if (err.status === 429) usage.markFull(pv);
      console.warn('downtime AI via ' + pv.id + ': ' + err);
      lastErr = err;
    }
  }
  if (!tried) return null;
  // ทุกเจ้าที่ลองโดน 429 = หมดโควตาทุกเจ้าแล้ว รอรอบหน้า (ไม่ใช่ข้อผิดพลาด)
  if (providers.every(function (pv) { return !usage.available(pv); })) return null;
  throw lastErr;
}

/**
 * ตรวจและปรับคำตอบของ AI ให้อยู่ในกรอบ: เวลาต้องอยู่ในช่วงทำงานของกะ นาทีคิดใหม่จาก start/end หักพัก
 * ถ้าไม่มี start/end ใช้นาทีที่ AI ให้มา (เช่น ข้อความบอก "รอ 13 นาที" แต่ไม่มีช่วงหยุดสแกนชัด)
 */
function dtValidateResult_(item, inc, group) {
  var win = group.win;
  var conf = ['high', 'medium', 'low'].indexOf(item && item.confidence) !== -1 ? item.confidence : 'low';
  var reason = String((item && item.reason) || '').slice(0, 200);
  var start = item && /^\d{1,2}:\d{2}$/.test(String(item.start)) ? dtIncidentTs_(inc.date, item.start) : NaN;
  var end = item && /^\d{1,2}:\d{2}$/.test(String(item.end)) ? dtIncidentTs_(inc.date, item.end) : NaN;
  var minutes;
  if (!isNaN(start) && !isNaN(end) && end > start) {
    start = Math.max(start, win.start);
    end = Math.min(end, group.ctx.workEnd);
    minutes = end > start ? (end - start - dtBreakOverlapMs_(start, end)) / 60000 : 0;
  } else {
    start = NaN; end = NaN;
    minutes = Number(item && item.minutes);
    if (!isFinite(minutes)) return null;
  }
  minutes = Math.max(0, Math.min(Math.round(minutes), 720));
  return {
    minutes: minutes, start: isNaN(start) ? '' : dtFormatHm_(start), end: isNaN(end) ? '' : dtFormatHm_(end),
    confidence: conf, reason: reason
  };
}

/** อ่านผลที่สรุปไว้แล้ว ใช้ทั้งตอนตอบหน้าเว็บ (GET_INCIDENTS) และตอนดูว่าเหตุการณ์ไหนต้องสรุปใหม่ */
function readDowntimeSummaries_(ss) {
  var sheet = ss.getSheetByName(DOWNTIME_TAB);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var head = values[0] || [];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var c = 0; c < head.length; c++) row[head[c]] = values[r][c];
    if (row.Key) {
      row.Minutes = Number(row.Minutes) || 0;
      ['Key', 'ID', 'Line', 'Date', 'Start', 'End', 'Confidence', 'Reason', 'Sig', 'By', 'UpdatedAt'].forEach(function (k) {
        row[k] = String(row[k] == null ? '' : row[k]).replace(/^'/, '');
      });
      out.push(row);
    }
  }
  return out;
}

function dtWriteSummaries_(ss, rows) {
  if (!rows.length) return;
  var sheet = ss.getSheetByName(DOWNTIME_TAB);
  if (!sheet) { sheet = ss.insertSheet(DOWNTIME_TAB); sheet.appendRow(DOWNTIME_COLS); }
  var values = sheet.getDataRange().getValues();
  var rowByKey = {};
  for (var r = 1; r < values.length; r++) rowByKey[String(values[r][0]).replace(/^'/, '')] = r + 1;
  rows.forEach(function (obj) {
    // นำหน้าข้อความด้วย ' กันชีตแปลงเวลา/วันที่เป็นชนิดอื่นเอง
    var line = DOWNTIME_COLS.map(function (k) {
      var v = obj[k];
      return k === 'Minutes' ? v : "'" + String(v == null ? '' : v);
    });
    if (rowByKey[obj.Key]) sheet.getRange(rowByKey[obj.Key], 1, 1, line.length).setValues([line]);
    else { sheet.appendRow(line); rowByKey[obj.Key] = sheet.getLastRow(); }
  });
}

/**
 * กลุ่มที่ตัดสินได้เองโดยไม่ต้องถาม AI (ประหยัดโควตา): ไลน์สแกนต่อเนื่อง ไม่มีช่วงหยุดเลย
 * และข้อความที่แจ้งไม่มีตัวเลข (ไม่ได้บอกระยะเวลา/เวลา) → Downtime 0
 */
function dtNeedsNoAi_(group) {
  return group.ctx.gaps.length === 0 && group.items.every(function (inc) { return !/\d/.test(inc.notes); });
}

/**
 * งานหลักที่ trigger เรียก (ตั้ง Time-driven ทุก 15 นาที) รันเองจาก editor ก็ได้เพื่อทดสอบ
 * คืนสรุปสั้น ๆ ว่าทำไปกี่รายการ
 */
function summarizeIncidentDowntimes() {
  // พิมพ์ผลลง log ด้วย กด Run จาก editor จะได้เห็นใน "บันทึกการดำเนินการ" (ค่า return ไม่แสดงที่นั่น)
  var result;
  try {
    result = dtSummarizeRun_();
  } catch (err) {
    console.error('summarizeIncidentDowntimes: ' + (err && err.stack || err));
    throw err;
  }
  console.log('summarizeIncidentDowntimes: ' + result);
  return result;
}

function dtSummarizeRun_() {
  // ไม่ใช้ script lock ตัวเดียวกับ doPost เพราะรอบนี้อาจรันหลายนาที หน้าเว็บจะรอค้างไปด้วย
  // ใช้ธงใน cache กันรอบซ้อนแทน (หมดอายุเองใน 10 นาที เผื่อรอบก่อนตายกลางทาง)
  var cache = CacheService.getScriptCache();
  if (cache.get('downtime_ai_running')) return 'busy (อีกรอบกำลังทำงานอยู่ ลองใหม่ใน 10 นาที)';
  cache.put('downtime_ai_running', '1', 600);
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var nowMs = Date.now();

    // 1) เหตุการณ์ทั้งหมด
    var incidents = [];
    var sheet = ss.getSheetByName('Incidents');
    if (sheet) {
      var values = sheet.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {
        var row = {};
        for (var j = 0; j < values[0].length; j++) row[values[0][j]] = values[i][j];
        incidents.push(row);
      }
    }
    try { incidents = incidents.concat(fetchMaintenanceIncidents_()); } catch (err) { console.warn('maintenance: ' + err); }

    var done = {};
    readDowntimeSummaries_(ss).forEach(function (s) { done[s.ID] = done[s.ID] || s.Sig; });

    var lookbackTs = nowMs - DOWNTIME_LOOKBACK_DAYS * 86400000;
    var stat = {recent: 0, waiting: 0, done: 0};
    var pending = incidents.map(dtNormalizeIncident_).filter(function (inc) {
      if (!inc) return false;
      var ts = dtIncidentTs_(inc.date, inc.time);
      if (isNaN(ts) || ts < lookbackTs) return false;
      stat.recent++;
      if (ts > nowMs - DOWNTIME_WAIT_MIN * 60000) { stat.waiting++; return false; }
      if (done[inc.id] === dtSig_(inc)) { stat.done++; return false; }
      return true;
    });
    if (!pending.length) {
      return 'nothing to do (' + incidents.length + ' incidents read, ' + stat.recent + ' in last ' +
        DOWNTIME_LOOKBACK_DAYS + ' days: ' + stat.done + ' already summarized, ' + stat.waiting +
        ' younger than ' + DOWNTIME_WAIT_MIN + ' min)';
    }

    // 2) สแกน + จัดกลุ่มตาม วัน/กะ/ไลน์
    var scansByLine = dtReadScansByLine_(lookbackTs - 86400000);
    var groups = {};
    pending.forEach(function (inc) {
      var win = dtShiftWindow_(inc.date, inc.hour);
      dtLinesForIncident_(inc, scansByLine, win).forEach(function (line) {
        var key = inc.date + '|' + (win.night ? 'N' : 'D') + '|' + line;
        (groups[key] = groups[key] || {date: inc.date, line: line, win: win, items: []}).items.push(inc);
      });
    });

    // 3) ให้ AI สรุปทีละกลุ่ม (ล่าสุดก่อน) 4) บันทึก
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    var usage = dtAiUsage_();
    var written = 0, aiCalls = 0, skippedForQuota = 0, quotaOut = false;
    var usedProviders = {};
    Object.keys(groups).sort().reverse().forEach(function (key) {
      var g = groups[key];
      var reports = g.items.map(function (inc) { return dtIncidentTs_(inc.date, inc.time); });
      var from = Math.min.apply(null, reports) - DOWNTIME_WINDOW_MIN * 60000;
      var to = Math.max.apply(null, reports) + DOWNTIME_WINDOW_MIN * 60000;
      g.ctx = dtScanGaps_(scansByLine[g.line] || [], g.win, from, to, nowMs);

      var answers, by;
      if (dtNeedsNoAi_(g)) {
        by = 'Rule';
        answers = g.items.map(function (inc) {
          return {id: inc.id, start: null, end: null, minutes: 0, confidence: 'high', reason: 'ไลน์สแกนต่อเนื่อง ไม่มีช่วงหยุดรอบเวลาที่แจ้ง'};
        });
      } else {
        // เกินโควตารอบนี้ หรือทุกเจ้าหมดโควตาวันนี้แล้ว เก็บไว้ทำรอบหน้า/วันถัดไป
        if (aiCalls >= DOWNTIME_AI_MAX_CALLS_PER_RUN || quotaOut) { skippedForQuota++; return; }
        if (aiCalls > 0) Utilities.sleep(DOWNTIME_AI_CALL_GAP_MS);
        aiCalls++;
        var got;
        try { got = dtCallAi_(dtBuildPrompt_(g), usage); }
        catch (err) { console.warn('downtime AI ' + key + ': ' + err); return; } // ลองใหม่รอบหน้า
        if (!got) { quotaOut = true; skippedForQuota++; return; }
        answers = got.answers;
        by = 'AI:' + got.provider;
        usedProviders[got.provider] = (usedProviders[got.provider] || 0) + 1;
      }
      var rows = [];
      g.items.forEach(function (inc, idx) {
        var item = answers.filter(function (a) { return a && String(a.id) === inc.id; })[0] || answers[idx];
        var res = dtValidateResult_(item, inc, g);
        if (!res) return;
        rows.push({
          Key: inc.id + '|' + g.line, ID: inc.id, Line: g.line, Date: inc.date,
          Minutes: res.minutes, Start: res.start, End: res.end, Confidence: res.confidence, Reason: res.reason,
          Sig: dtSig_(inc), By: by, UpdatedAt: stamp
        });
      });
      dtWriteSummaries_(ss, rows);
      written += rows.length;
    });
    return 'summarized ' + written + ' of ' + pending.length + ' pending incidents (AI calls ' + aiCalls +
      ', by ' + (Object.keys(usedProviders).map(function (k) { return k + ' ' + usedProviders[k]; }).join(', ') || '-') +
      (skippedForQuota ? ', ' + skippedForQuota + ' groups wait for quota' : '') + ')';
  } finally {
    cache.remove('downtime_ai_running');
  }
}
