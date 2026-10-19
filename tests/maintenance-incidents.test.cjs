const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = { console: {warn() {}}, Utilities: { formatDate(date, zone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return pattern==='H' ? parts.hour : pattern==='HH:mm' ? `${parts.hour}:${parts.minute}` : `${parts.year}-${parts.month}-${parts.day}`;
}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('gas_sync_incidents.js','utf8'),ctx);
const job = {book:'ENC',mtJob:'19102026-1',line:'Line 5',timestamp:'2026-10-18T18:35:00Z',symptom:'Motor stopped',status:'แจ้งซ่อม',downtime:0};
let rows = ctx.maintenanceJobsToIncidents_([job,job,{...job,book:'ASSY',mtJob:'AS-1'},{...job,mtJob:'bad',timestamp:''}]);
assert.equal(rows.length,1);
assert.equal(rows[0].Date,'2026-10-18');
assert.equal(rows[0].Hour,1);
assert.equal(rows[0].Time,'01:35');
assert.equal(rows[0].Line,'5');
assert.equal(rows[0].Shift,'Night');
assert.equal(rows[0].Source,'maintenance');
assert.ok(rows[0].ID.startsWith('2026-10-18_1_'));
assert.match(rows[0].Notes,/19102026-1/);
rows=ctx.maintenanceJobsToIncidents_([{...job,timestamp:'2026-10-19T01:00:00Z'},{...job,mtJob:'two',timestamp:'2026-10-19T13:00:00Z'}]);
assert.equal(rows[0].Date,'2026-10-19');assert.equal(rows[0].Shift,'Day');assert.equal(rows[1].Shift,'Night');
ctx.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({success:true,data:[job]})})};
assert.equal(ctx.fetchMaintenanceIncidents_().length,1);
ctx.UrlFetchApp={fetch:()=>({getResponseCode:()=>403})};
assert.throws(()=>ctx.fetchMaintenanceIncidents_(),/HTTP 403/);
ctx.LockService={getScriptLock:()=>({tryLock(){},releaseLock(){}})};
ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>null})};
ctx.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})};
let result=ctx.doPost({postData:{contents:'{"action":"GET_INCIDENTS"}'}});
assert.equal(result.result,'success');assert.ok(result.maintenanceWarning);assert.equal(result.incidents.length,0);
ctx.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({success:true,data:[job]})})};
result=ctx.doPost({postData:{contents:'{"action":"GET_INCIDENTS"}'}});
assert.equal(result.incidents.length,1);assert.equal(result.maintenanceWarning,'');
console.log('Maintenance mapping, boundaries, deduplication, area isolation, API errors, and GET_INCIDENTS passed');

ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>[['ID','Date','Hour','Line'],['manual-1','2026-10-18',1,'5']]})})})};
result=ctx.doPost({postData:{contents:'{"action":"GET_INCIDENTS"}'}});
assert.equal(result.incidents.length,2);assert.equal(result.incidents[0].ID,'manual-1');
ctx.UrlFetchApp={fetch:()=>{throw new Error('offline')}};
result=ctx.doPost({postData:{contents:'{"action":"GET_INCIDENTS"}'}});
assert.equal(result.incidents.length,1);assert.equal(result.incidents[0].ID,'manual-1');assert.ok(result.maintenanceWarning);
const html=fs.readFileSync('barcode.html','utf8');
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
 if(!/\bsrc=/.test(match[1])) new vm.Script(match[2]);
}
console.log('Manual incidents survive upstream errors; frontend inline scripts compile');

ctx.UrlFetchApp={fetch:()=>{throw new Error('You do not have permission to call UrlFetchApp.fetch. Required permissions: script.external_request')}};
result=ctx.doPost({postData:{contents:'{"action":"GET_INCIDENTS"}'}});
assert.equal(result.maintenanceError,'MAINTENANCE_AUTHORIZATION_REQUIRED');
assert.equal(result.incidents[0].ID,'manual-1');
ctx.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>'<html>login</html>'})};
assert.throws(()=>ctx.fetchMaintenanceIncidents_(),/MAINTENANCE_NON_JSON_RESPONSE/);
console.log('Authorization and invalid-response diagnostics passed');

const originalError = new Error('Required permissions: https://www.googleapis.com/auth/script.external_request');
ctx.UrlFetchApp={fetch:()=>{throw originalError}};
assert.throws(()=>ctx.authorizeMaintenanceIntegration(),err=>err===originalError);
assert.throws(()=>ctx.fetchMaintenanceIncidents_(),/MAINTENANCE_AUTHORIZATION_REQUIRED/);
const manifest=JSON.parse(fs.readFileSync('apps-script/incident-sync/appsscript.json','utf8'));
assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
console.log('Editor preserves original errors; manifest declares required service permissions');
