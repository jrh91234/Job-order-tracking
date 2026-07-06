// ==========================================
// ⚙️ ส่วนตั้งค่า (Configuration)
// ==========================================
const SHEET_ID = '1PYcAatoJ4QX28uQ_LF8dDC6oTiMWbfPs5TZDfGJVa4U'; 
const MODEL_SHEET_NAME = 'โมเดล';       
const DESTINATION_SHEET_NAME = 'Plan';  

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('Drive Scanner V.25 (Ban TH- & JRTL)');
}

// ==========================================
// 🧠 ฟังก์ชันหลัก V.25
// ==========================================
function processFileWithDrive(base64Data, mimeType) {
  let fileId;
  try {
    let text = "";

    // 📂 รับ Plain Text จาก Frontend (Excel)
    if (mimeType === 'text/plain') {
       const decoded = Utilities.base64Decode(base64Data);
       text = Utilities.newBlob(decoded).getDataAsString();
    } 
    // 📸 รับรูปภาพ (OCR)
    else {
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, 'temp_file');
      const resource = { title: blob.getName(), mimeType: blob.getContentType() };
      const file = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: "th" });
      fileId = file.id;
      const doc = DocumentApp.openById(fileId);
      text = doc.getBody().getText();
      Drive.Files.remove(fileId); 
    }

    // --- Pre-process ---
    text = text.replace(/Q0/g, 'QO').replace(/S\/N/g, 'SN');

    let data = {
      jobOrder: "", matchedModel: "", planQty: "",
      issueDate: "", finishDate: "", 
      isMatch: false, matchType: "none",
      scores: { job: 0, model: 0, qty: 0, date: 0 },
      rawText: text 
    };

    // 1. Job Order
    const jobMatch = text.match(/TH-SCDD\d+/);
    if (jobMatch) {
      data.jobOrder = jobMatch[0];
      data.scores.job = 100;
    }

    // 2. Dates (dd/mm/yyyy)
    const dateMatches = text.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}\b/g);
    if (dateMatches && dateMatches.length >= 1) {
      data.issueDate = dateMatches[0];
      data.scores.date = 100;
      if (dateMatches.length >= 2) data.finishDate = dateMatches[1];
    }

    // 3. Qty
    const allNumbers = [...text.matchAll(/\b\d{1,5}\b/g)]; 
    let bestCandidate = null;
    let maxScore = -9999;
    const keywords = ["计划数量", "จำนวน", "จํานวน", "Qty", "Quantity", "Planned", "วางแผน"]; 
    
    allNumbers.forEach(match => {
       const numStr = match[0];
       const idx = match.index;
       const numVal = parseInt(numStr);
       let score = 0;

       if (numStr.startsWith("202") || numVal === 0) score -= 1000;
       if (data.jobOrder && data.jobOrder.includes(numStr)) score -= 1000;
       
       const charBefore = idx > 0 ? text.charAt(idx - 1) : "";
       const charAfter = (idx + numStr.length) < text.length ? text.charAt(idx + numStr.length) : "";
       if (['-', '/', '.'].includes(charBefore) || ['-', '/', '.'].includes(charAfter)) score -= 5000;

       const contextAfter = text.substring(idx + numStr.length, idx + numStr.length + 20).toLowerCase();
       if (contextAfter.includes("way") || contextAfter.includes("ka") || contextAfter.includes("pole") || contextAfter.includes("v")) score -= 500;

       keywords.forEach(kw => {
          const kwIdx = text.indexOf(kw);
          if (kwIdx !== -1) {
             const distance = Math.abs(kwIdx - idx);
             if (distance < 100) score += (200 - distance); 
             if ((kw === "计划数量" || kw === "จำนวน") && distance < 150) score += 300;
          }
       });
       if (numVal > 20) score += 50; 
       if (score > maxScore) { maxScore = score; bestCandidate = numStr; }
    });
    
    if (bestCandidate && maxScore > -500) {
      data.planQty = bestCandidate;
      data.scores.qty = Math.min(100, Math.max(0, Math.round((maxScore / 300) * 100)));
    }

    // 4. Model (Updated: Ban TH- & JRTL)
    const exactMatch = findExactModelInText(text);
    if (exactMatch.found) {
      data.matchedModel = exactMatch.model;
      data.isMatch = true;
      data.matchType = "exact";
      data.scores.model = 100;
    } else {
      const codeMatch = text.match(/[A-Z0-9\-\/]{5,}/g);
      let regexCandidate = "";
      
      if (codeMatch) {
         regexCandidate = codeMatch.find(c => 
           (c.startsWith('R9') || c.startsWith('SD') || c.startsWith('QO') || c.startsWith('Q0') || c.startsWith('S9') || c.includes('-')) && 
           !c.startsWith('TH-') &&  // ⭐ กฎใหม่: ห้ามขึ้นต้นด้วย TH-
           !c.startsWith('JRTL') && // ⭐ กฎใหม่: ห้ามขึ้นต้นด้วย JRTL
           !c.includes('WAYS') && !c.includes('LOAD') && !c.includes('CENTER') &&
           c.length > 5
         ) || "";
      }

      if (regexCandidate) {
        const fuzzyResult = findClosestModelInDB(regexCandidate);
        if (fuzzyResult.found) {
          data.matchedModel = fuzzyResult.model;
          data.isMatch = true;
          data.matchType = "fuzzy";
          data.scores.model = calculateSimilarity(regexCandidate, fuzzyResult.model);
        } else {
          data.matchedModel = regexCandidate;
          data.isMatch = false;
          data.matchType = "none";
          data.scores.model = 50; 
        }
      }
    }

    return data;

  } catch (e) {
    if (fileId) { try { Drive.Files.remove(fileId); } catch(x){} }
    return { error: "Processing Error: " + e.toString() };
  }
}

// ==========================================
// 🛠️ Helper Functions
// ==========================================
function findExactModelInText(fullText) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(MODEL_SHEET_NAME);
    if (!sheet) return { found: false };
    
    const list = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    const cleanText = fullText.replace(/\s/g, '').toUpperCase().replace(/Q0/g, 'QO');

    let bestMatch = "";
    let maxScore = -9999; 

    for (let i = 0; i < list.length; i++) {
      const dbModelRaw = String(list[i][0]);
      if(dbModelRaw.length < 3) continue;

      const dbModelClean = dbModelRaw.replace(/\s/g, '').toUpperCase().replace(/Q0/g, 'QO');
      
      if (cleanText.includes(dbModelClean)) {
        let score = dbModelRaw.length; 
        
        // Bonus
        if (dbModelRaw.includes('-') || dbModelRaw.includes('/')) score += 50; 
        if (dbModelRaw.match(/\d/) && dbModelRaw.match(/[A-Z]/)) score += 10; 
        if (dbModelRaw.startsWith('QO') || dbModelRaw.startsWith('SD') || dbModelRaw.startsWith('R9')) score += 20; 

        // Penalty (Description)
        const descriptionWords = ['WAYS', 'LOAD', 'CENTER', 'CONSUMER', 'UNIT', 'SPLIT', 'BOX', 'PH', 'PN'];
        descriptionWords.forEach(word => { if (dbModelRaw.includes(word)) score -= 100; });
        
        // ⭐ Penalty (Ban Words) - หักคะแนนหนักถ้าเป็นคำต้องห้าม
        if (dbModelRaw.startsWith('JRTL') || dbModelRaw.startsWith('TH-')) {
            score = -5000; 
        }

        if (score > maxScore) { bestMatch = dbModelRaw; maxScore = score; }
      }
    }
    
    // ถ้าคะแนนติดลบ (เช่นเจอแต่ JRTL) ให้ถือว่าไม่เจอ
    if (maxScore < 0) return { found: false };
    
    return bestMatch ? { found: true, model: bestMatch } : { found: false };
  } catch (e) { return { found: false }; }
}

function findClosestModelInDB(candidate) {
  // ⭐ เช็คตั้งแต่ปากประตู: ถ้าคำที่ส่งมาเป็นคำต้องห้าม ให้ดีดออกทันที
  if (candidate.startsWith('JRTL') || candidate.startsWith('TH-')) return { found: false };

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(MODEL_SHEET_NAME);
    const list = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    const normalize = (str) => str.toUpperCase().replace(/[\s\-\/]/g, '').replace(/0/g, 'O').replace(/8/g, 'B');
    const target = normalize(candidate);
    let bestFuzzyMatch = "";
    for (let i = 0; i < list.length; i++) {
      const dbModelRaw = String(list[i][0]);
      if(dbModelRaw.length < 3) continue;
      const dbTarget = normalize(dbModelRaw);
      if (dbTarget === target || dbTarget.includes(target) || target.includes(dbTarget)) {
         if (dbModelRaw.length > bestFuzzyMatch.length) bestFuzzyMatch = dbModelRaw;
      }
    }
    return bestFuzzyMatch ? { found: true, model: bestFuzzyMatch } : { found: false };
  } catch (e) { return { found: false }; }
}

function calculateSimilarity(s1, s2) {
  let longer = s1, shorter = s2;
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  let longerLength = longer.length;
  if (longerLength === 0) return 100;
  return Math.round(((longerLength - editDistance(longer, shorter)) / longerLength) * 100);
}

function editDistance(s1, s2) {
  s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
  let costs = new Array();
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) != s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

function saveBatchToSheet(dataArray) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(DESTINATION_SHEET_NAME);
    if (!sheet) return "Error: ไม่พบชีท " + DESTINATION_SHEET_NAME;

    const lastRow = sheet.getLastRow();
    const existingJobs = lastRow > 1 ? sheet.getRange(2, 4, lastRow - 1, 1).getValues().flat().map(String) : [];
    
    let savedCount = 0;
    let duplicateCount = 0;

    dataArray.forEach(item => {
      const job = String(item.jobOrder).trim();
      if (job && !existingJobs.includes(job)) {
        sheet.appendRow([ new Date(), "Drive OCR", item.issueDate, item.jobOrder, item.issueDate, item.finishDate, item.matchedModel, item.planQty ]);
        existingJobs.push(job); savedCount++;
      } else { duplicateCount++; }
    });

    return duplicateCount > 0 
      ? `✅ บันทึกใหม่ ${savedCount} รายการ (⚠️ ข้ามซ้ำ ${duplicateCount})`
      : `✅ บันทึกสำเร็จครบ ${savedCount} รายการ`;
  } catch (e) { return "Error: " + e.toString(); } 
  finally { lock.releaseLock(); }
}

function forceAuth() { Drive.Files.list({maxResults: 1}); DocumentApp.create("Temp_Auth_Doc"); }