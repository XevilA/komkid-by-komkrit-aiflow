# คมคิด by KOMKRIT — Responsive CRUD WebApp & Multi-Agent AI Content Creation Ecosystem

ระบบเว็บแอปพลิเคชันแบบ **Full-Stack Responsive (Desktop / Tablet / Mobile)** พร้อมระบบหลังบ้าน **CMS CRUD จัดการข่าวสาร ความรู้ วิดีโอ คอร์สเรียน** และ **ศูนย์บัญชาการ AI Multi-Agent Content Creation Flow** ตามสถาปัตยกรรม *KOMKRIT Multi-Agent Content Ecosystem & 5-Pillar Business Model*

---

## โครงสร้างความสามารถหลัก (Key Features)

### 1. หน้าเว็บไซต์หลัก (Responsive Public WebApp)
- รองรับทุกขนาดหน้าจอ (Desktop 3-Column Layout & Mobile Responsive Layout) ตามต้นฉบับแบรนด์ **คมคิด by KOMKRIT ("คิดต่างอย่างสร้างสรรค์")**
- **7 หมวดหมู่หลัก:** การศึกษา, นวัตกรรม, สังคม, ต่างประเทศ, อาชีพ & การพัฒนา, AI & เทคโนโลยี, บทความพิเศษ
- **ระบบอ่านบทความและวิดีโอ:** รองรับการฝังวิดีโอ YouTube, ปุ่มฟังเสียงอ่านบทความภาษาไทย (Live Thai TTS), ระบบค้นหาแบบเรียลไทม์, ระบบส่งเสียงสะท้อนผู้ชม (Audience Feedback & Rating), ระบบสมัครรับข่าวสาร (Newsletter) และหน้าติดต่อทีมงาน
- **โครงการพิเศษ & 5-Pillar Business Model:** แสดงรายละเอียดโครงการ *โรงเรียนภาษาและอาชีพ ไทย-เมียนมา* และโมเดลธุรกิจ 5 เสาหลัก (*Content → Audience → Trust*)

### 2. ระบบหลังบ้าน (Backend Admin Full CRUD CMS)
- **Create / Read / Update / Delete** ข่าวสาร บทความ ความรู้ วิดีโอ และคอร์ส/เวิร์กช็อป
- อัปโหลดรูปภาพจากเครื่องคอมพิวเตอร์ (`/api/upload`), เลือกภาพเทมเพลต หรือสร้างภาพปก Infographic อัตโนมัติด้วย AI
- ตั้งค่า **บทความพิเศษเด่นหน้าแรก (Featured Hero Post)** และสลับสถานะ เผยแพร่ / ฉบับร่าง ได้ในคลิกเดียว
- จัดการคอมเมนต์ผู้ชม, สมาชิกรับข่าวสาร และข้อความติดต่อทั้งหมดเก็บถาวรในฐานข้อมูล SQLite (`data/komkrit.db`)

### 3. ศูนย์บัญชาการ AI Multi-Agent Content Ecosystem
- **AGENT CEO (Command Center):** สั่งงานผ่าน CEO Agent จุดเดียว เชื่อมต่อกับ **ฐานความรู้ (Knowledge Base CRUD)**
- **8 Specialized AI Agents:**
  1. `01 Research Agent` — ค้นคว้าเชิงลึก วิเคราะห์แนวโน้ม และอ้างอิงฐานความรู้
  2. `02 Idea & Script Agent` — คิดพาดหัว 3 มุมมอง จุดประสงค์การเรียนรู้ บทความเต็ม และสคริปต์วิดีโอ
  3. `03 Content Design Agent` — วางโครงสร้างเนื้อหา แผนผังความคิด (Mind Map) และโครงร่างสไลด์
  4. `04 Visual Creator Agent` — สร้างภาพปก SVG Infographic อัตโนมัติ พร้อมชุด Prompt สำหรับ Gemini Nano Banana 2.1 / Midjourney / Canva AI
  5. `05 Video Production Agent` — สร้างตาราง Storyboard ฉากต่อฉาก เวลา บทพูด ซับไตเติล และ B-Roll
  6. `06 Audio Production Agent` — บทพากย์พร้อมจังหวะเสียง ดนตรีประกอบ และปุ่มทดสอบฟังเสียงพากย์ภาษาไทยทันที
  7. `07 Quality Check (QA) Agent` — ตรวจคุณภาพ 4 มิติ (*Fact Check, Language, Brand, Risk/PDPA*) พร้อมคะแนนและผลการประเมิน
  8. `08 Analytics & Omnichannel Agent` — วิเคราะห์ผลลัพธ์และเตรียมเนื้อหาพร้อมโพสต์ครบ **8 ช่องทาง** (YouTube, Facebook, TikTok, LINE OA, X, Instagram, Website/Blog, Email/Newsletter)
- **HUMAN APPROVAL (Human-in-the-Loop):** ตรวจเช็ก 4 ข้อ (ถูกต้อง, เหมาะสม, ตรงกับแบรนด์, พร้อมเผยแพร่), สั่ง AI แก้ไขเพิ่มเติม หรือกด **อนุมัติ & เผยแพร่ขึ้นหน้าเว็บไซต์จริงทันที**

---

## วิธีรันโปรเจกต์ (Quick Start)

```bash
# โหมดพัฒนา (Hot Reload ทั้ง Frontend + Backend บนพอร์ตเดียว)
npm run dev

# หรือโหมด Production (หลังจาก npm run build)
npm start
```

เปิดเบราว์เซอร์ไปที่: **http://localhost:3000**
- กดปุ่ม **"หลังบ้าน & AI Studio"** มุมขวาบนเพื่อเข้าสู่ระบบจัดการโพสต์ CRUD และศูนย์บัญชาการ AI Multi-Agent
- สามารถตั้งค่า `GEMINI_API_KEY` (รองรับ `@google/genai` รุ่น `gemini-3.8-flash` และ `gemini-4-argon`) หรือเชื่อมต่อ Local LLM ได้ที่เมนู **ตั้งค่า AI Engine** (และสามารถใช้งาน Built-in Komkrit Smart Engine ได้ทันทีโดยไม่ต้องตั้งค่าคีย์)
