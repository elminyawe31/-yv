# ELMINYAWE — Premium Media Studio

<div align="center">

**ELMINYAWE MEDIA STUDIO** — محوّل الوسائط الفاخر من يوتيوب إلى روابط MP3 / MP4 مباشرة

The premium YouTube → MP3 / MP4 converter that generates **permanent, direct links under your own domain**.

</div>

---

## ✨ المميزات | Features

| | |
|---|---|
| 🎵 **MP3 & MP4** | جودات استوديو حتى 320K / فيديو حتى 1080p — Studio audio up to 320K, video up to 1080p |
| ⚡ **محركان بتجاوز تلقائي** | محرك 1 + محرك 2 مع فشَل تلقائي — Dual engines with automatic failover |
| 🔗 **روابط دائمة بنطاقك** | `/e/ELMINYAWE-xxx.mp3` يُبث من موقعك — Permanent links streamed from your own domain |
| ☁️ **تخزين Catbox دائم بالكامل** | الملفات والسجلات معًا، بلا توكنات — Files AND records on permanent Catbox storage, zero tokens |
| 🌍 **ثنائي اللغة** | عربي / إنجليزي مع RTL كامل — Arabic / English with full RTL support |
| 🛡️ **حواجز أمان** | CSP صارمة، تحديد معدل، بدون تتبع — Strict CSP, rate limiting, zero tracking |
| 👑 **لوحة تحكم مخفية** | للمشرف فقط — Hidden admin control panel |

## 🚀 التشغيل المحلي | Local Development

```bash
# 1) Install dependencies (Node 20+ or Bun)
npm install        # or: bun install

# 2) (Optional) configure the environment
cp .env.example .env

# 3) Push the database schema (SQLite file auto-created)
npm run db:push

# 4) Start
npm run dev        # → http://localhost:3000
```

## ☁️ النشر على Vercel | Deploy to Vercel

1. **push هذا المستودع إلى GitHub** — Push this repo to GitHub.
2. من Vercel: **Add New → Project → Import** مستودعك.
   From Vercel: **Add New → Project → Import** your repo.
3. لا حاجة لأي إعدادات بناء خاصة — Vercel يكتشف Next.js تلقائيًا
   (`prisma generate` يعمل ضمن سكربت البناء تلقائيًا).
   No special build settings needed — Next.js is auto-detected.
4. *(اختياري)* أضف المتغيرات من `.env.example` في:
   **Settings → Environment Variables** — أهمها `ADMIN_PASSWORD`.
   *(Optional)* Add variables from `.env.example*` under **Settings → Environment Variables** — most importantly `ADMIN_PASSWORD`.

> **التخزين على Vercel (v5.4 — Catbox فقط):** الملفات والسجلات والإعدادات كلها تعيش على حساب Catbox الدائم — **بلا أي توكنات ولا أي إعداد**. روابط `/e/…` تعمل للأبد، والسجل والإحصاءات وإعدادات اللوحة تبقى عبر إعادة التشغيل والمناطق تلقائيًا (مستند سجلات واحد مفهرس بألبوم مخصص على نفس الحساب).
>
> **Storage on Vercel (v5.4 — Catbox only):** files, records AND settings all live on the permanent Catbox account — **zero tokens, zero setup**. `/e/…` links last forever, and history/stats/panel settings survive restarts and regions automatically (one records document indexed by a dedicated album on the same account).

## 👑 لوحة التحكم المخفية | Hidden Admin Panel

- **الفتح:** اضغط شعار **ELMINYAWE MEDIA STUDIO** أسفل الموقع.
  **Open:** click the **ELMINYAWE MEDIA STUDIO** mark in the footer.
- **كلمة المرور الافتراضية:** `Yao12-#` — ⚠ **غيّرها فورًا** عبر متغير `ADMIN_PASSWORD`.
  **Default password:** `Yao12-#` — ⚠ **change it** via the `ADMIN_PASSWORD` env var.

### ماذا تفعل داخل اللوحة؟ | What can it do?

| الوظيفة | الشرح |
|---|---|
| **استبدال خدمة تجاوز Turnstile** | إذا انتهت مدة خدمتك على Railway أو توقفت، الصق رابط الخدمة البديلة (بنفس وظيفة `/solve?url=...&sitekey=...`) ثم اضغط **اختبار** و**حفظ واستبدال** — يسري فورًا دون إعادة نشر |
| **اختبار حقيقي** | زر الاختبار يحل تحدي Turnstile فعليًا ويعرض الزمن |
| **استعادة الافتراضي** | يزيل الاستبدال ويرجع للرابط المضمّن |
| **مسح سجل العمليات** | حذف كل قيود التحويلات والملفات المحلية المرآة (للمشرف فقط) |

| Task | Description |
|---|---|
| **Swap the Turnstile solver** | When your Railway service expires, paste the replacement URL (same `/solve?url=...&sitekey=...` function), **Test**, then **Save & replace** — effective instantly, no redeploy |
| **Real test** | The Test button solves an actual Turnstile challenge and reports timing |
| **Reset to default** | Removes the override, back to the built-in URL |
| **Clear the log** | Delete all conversion records + local mirrored files (admin only) |

## ⚙️ المتغيرات | Environment Variables

كل القيم اختيارية ولها افتراضيات مضمّنة — All values optional with sane defaults:

| Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | `Yao12-#` | كلمة مرور لوحة التحكم — admin panel password |
| `ELMINYAWE_SOLVER_URL` | built-in | رابط خدمة تجاوز Turnstile — Turnstile solver URL (`off` = disabled) |
| `DATABASE_URL` | auto | مسار SQLite — SQLite path |
| `CATBOX_USERHASH` | baked-in | حساب التخزين الدائم — permanent storage account |
| `ELMINYAWE_RECORDS_ALBUM` | `rcs8x8` | ألبوم فهرس مستند السجلات — records index album |
| `ELMINYAWE_RECORDS_STORE` | auto | `catbox` / `sqlite` (سفر-هوست) — force records store |
| `MAX_FILE_MB` | `80` | الحد الأقصى لحجم الملف — max file size |
| `PROVIDER_ORDER` | `ytmp3gl,marisa` | ترتيب المحركات — engine order |
| `CAPSOLVER_API_KEY` / `TWO_CAPTCHA_API_KEY` | — | احتياطي مدفوع — paid fallback solvers |

## 🔒 الأمان | Security

- CSP صارمة + HSTS في الإنتاج — Strict CSP + HSTS in production.
- جلسة أدمن بلا حالة موقّعة HMAC-SHA256 (12 ساعة) — stateless HMAC-signed admin session (12h).
- مقارنة كلمة المرور بزمن ثابت + تحديد 8 محاولات/10 دقائق — constant-time compare + 8 attempts/10 min.
- تحديد معدل على كل مسارات التحويل — rate limiting on all conversion endpoints.
- أسماء الخدمات الخارجية لا تظهر أبدًا في الواجهة — external service names never leak to the UI.

## 📁 البنية | Structure

```
src/
  app/                  # الصفحة + مسارات API (Next.js App Router)
    api/convert/        # تحويل بث NDJSON للتقدم الحي
    api/admin/          # مصادقة المشرف + إدارة خدمة الحل
    e/[file]/           # بث الملفات الناتجة (Range كامل)
  components/site/      # واجهة ELMINYAWE (فاتحورة داكنة + ذهبية)
  lib/elminyawe/        # المحركات، التخزين، الأمان، الأدمن
prisma/schema.prisma    # Conversion + AdminSetting
```

---

<div align="center">

© ELMINYAWE — جميع الحقوق محفوظة | All rights reserved.

</div>
