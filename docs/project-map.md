# Project Map (Focused-Reading Guide)

This file is a lightweight index to help agents read the **right files first**.
Update this file whenever a new major folder or service is added.

## How to use
- Start here before opening code files.
- Route the task to the most relevant folder(s).
- If ownership is unclear, ask one clarifying question before widening scope.

## Areas
- `docs/`: operational docs and agent guidance.
- `docs/apps-script-map.md`: **อ่านก่อนแตะโค้ดฝั่ง Google Apps Script ทุกครั้ง**
  ระบบนี้มี Apps Script 2 โปรเจกต์แยกกันโดยตั้งใจ (ลงยอด และ บันทึกเหตุการณ์)
  ไฟล์นั้นบอกว่าโปรเจกต์ไหนอยู่ที่ไหน URL อะไร เขียนแท็บอะไร และห้ามทำอะไร
- `scr/`: ซอร์สของโปรเจกต์ Apps Script ฝั่งลงยอด (ชื่อโปรเจกต์ `KPI`)
- `gas_sync_incidents.js`: ซอร์สของโปรเจกต์ Apps Script ฝั่งบันทึกเหตุการณ์ (แยกอิสระ)
- `gas_cleanup_incidents.js`: เครื่องมือล้างแถวเสียในชีต มี dry run ให้ตรวจก่อนลบเสมอ
- `barcode.html`, `index.html`, `dashboard.html`: หน้าจอผู้ใช้ทั้งหมด (แต่ละไฟล์รวม HTML/CSS/JS ไว้ในตัว)
- `config.json`: ค่าตั้งต้นที่หน้าจอดึงไปใช้ รวมถึง URL ของ Web App ฝั่งบันทึกเหตุการณ์

## Task routing checklist
1. Identify feature/bug domain from user request.
2. Map request to a primary folder and likely entry file(s).
3. Read files that define behavior first (core logic, interface, tests).
4. Expand only when required to verify dependencies or side effects.
