"use client"

import { motion } from "framer-motion"
import {
  Link2, Cpu, Globe, Zap, AudioLines, Infinity as InfinityIcon,
  EyeOff, Server, Smartphone, Scissors, Disc3, RotateCcw, ImageDown, Clapperboard,
  ListVideo, Layers,
} from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useLang, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { SectionHead } from "./section-head"

/* ---------------- How it works ---------------- */

function stepsFor(lang: Lang) {
  if (lang === "en") {
    return [
      {
        icon: Link2,
        step: "01",
        title: "Paste the link",
        desc: "Copy the video link from YouTube — a music track, a podcast, a lecture, or any content you have the right to download — and paste it into the converter box.",
      },
      {
        icon: Cpu,
        step: "02",
        title: "The engines go to work",
        desc: "A smart chain of two API engines: Engine 1 leads — it bypasses the smart protection challenge automatically — and Engine 2 follows as a fast backup. If one fails, the system moves on to the other automatically, without you ever noticing.",
      },
      {
        icon: Globe,
        step: "03",
        title: "Your link is ready",
        desc: "You get an elegant link under the ELMINYAWE name that plays straight from the browser — stream it, download it, or embed it on your site with no restrictions.",
      },
    ]
  }
  return [
    {
      icon: Link2,
      step: "٠١",
      title: "ألصق الرابط",
      desc: "انسخ رابط الفيديو من يوتيوب — مقطع موسيقى، بودكاست، محاضرة، أو أي محتوى تملك حق تنزيله — وألصقه في صندوق التحويل.",
    },
    {
      icon: Cpu,
      step: "٠٢",
      title: "المحرك يعمل",
      desc: "سلسلة محركين ذكية عبر API: يبدأ «المحرك 1» متجاوزًا تحدي الحماية الذكي تلقائيًا، و«المحرك 2» سريع كاحتياط — إذا تعطل أحدهما ينتقل النظام للآخر تلقائيًا دون أن تشعر.",
    },
    {
      icon: Globe,
      step: "٠٣",
      title: "رابطك جاهز",
      desc: "تحصل على رابط أنيق بهوية ELMINYAWE يعمل مباشرة من المتصفح — شغّله، نزّله، أو ضمّنه في موقعك دون أي قيود.",
    },
  ]
}

export function HowItWorks() {
  const { lang, tr } = useLang()
  const steps = stepsFor(lang)
  return (
    <section id="how" className="relative py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow={tr("المسار · ٠١", "The path · 01")}
          title={tr("كيف يعمل", "How does")}
          highlight={tr("ELMINYAWE؟", "ELMINYAWE work?")}
          description={tr(
            "ثلاث خطوات شفافة — من الرابط إلى ملفك الشخصي، دون تعقيد ودون وسطاء",
            "Three transparent steps — from the link to your own file, with no complexity and no middlemen"
          )}
        />

        <div className="relative mt-12 grid gap-5 md:grid-cols-3">
          {/* connecting line */}
          <div className="pointer-events-none absolute top-[52px] hidden h-px w-full md:block"
            style={{ background: "linear-gradient(90deg, transparent, rgba(233,162,59,0.25), rgba(233,162,59,0.25), transparent)" }}
          />
          {steps.map((step, i) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="glass glass-hover step-card group relative rounded-3xl p-6 sm:p-7"
            >
              <span className="card-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex items-start justify-between">
                <span className="step-icon flex h-12 w-12 items-center justify-center rounded-2xl border border-[#e9a23b]/25 bg-[#e9a23b]/[0.08]">
                  <step.icon className="h-5.5 w-5.5 text-[#f0c274]" strokeWidth={1.8} />
                </span>
                <span className="font-mono text-sm font-bold text-[#e9a23b]/35">{step.step}</span>
              </div>
              <h3 className="mt-5 font-display text-lg font-bold">{step.title}</h3>
              <p className="mt-2.5 text-[13.5px] leading-7 text-muted-foreground">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- Features ---------------- */

function featuresFor(lang: Lang) {
  if (lang === "en") {
    return [
      {
        icon: Cpu,
        title: "Two engines with automatic failover",
        desc: "Two API engines run in a smart sequence: Engine 1 bypasses protection challenges automatically, and Engine 2 follows as a fast backup — one of them failing never stops your conversion.",
      },
      {
        icon: Zap,
        title: "Lightning fast",
        desc: "An optimized pipeline finishes most conversions in about a minute, with progress streamed live, moment by moment.",
      },
      {
        icon: AudioLines,
        title: "Studio quality",
        desc: "MP3 audio up to 320kbps and MP4 video at 1080p — we always pick the best track the source can offer.",
      },
      {
        icon: InfinityIcon,
        title: "Permanent links",
        desc: "Your links never expire and never need renewing; files live in permanent external storage and stream through the ELMINYAWE domain.",
      },
      {
        icon: EyeOff,
        title: "Complete privacy",
        desc: "No accounts, no tracking, no data retention. Temporary workspaces are wiped the instant your request completes.",
      },
      {
        icon: Server,
        title: "Instant streaming",
        desc: "A built-in player lets you listen and watch before downloading, with full Range-streaming support on mobile devices.",
      },
      {
        icon: Smartphone,
        title: "Instant phone transfer",
        desc: "Scan the QR code on screen and the download link jumps straight to your phone — or share it directly via WhatsApp and Telegram, no sign-in required.",
      },
      {
        icon: Globe,
        title: "Flexible embedding",
        desc: "Player-ready for your pages: an audio or video player that runs with a single line of code on any site or blog you own.",
      },
      {
        icon: Scissors,
        title: "Clip trimming",
        desc: "Extract exactly the moment you want: set the range with two draggable golden handles on an interactive bar and get just the clip — not the rest of the video.",
      },
      {
        icon: Disc3,
        title: "ID3 tags & auto cover art",
        desc: "Every MP3 ships with the video title, channel name, and original cover art embedded inside the file — ready for players, your car, and your phone.",
      },
      {
        icon: Clapperboard,
        title: "Full MP4 tags",
        desc: "Video files carry their identity too: title and channel name embedded in the MP4 using the standard iTunes-style format — so media libraries show the correct name.",
      },
      {
        icon: RotateCcw,
        title: "One-click reconvert",
        desc: "From your history, rerun any conversion with the same format and quality in a single click — the link is prefilled and the conversion starts automatically, no extra steps.",
      },
      {
        icon: ImageDown,
        title: "Original cover download",
        desc: "Download the video's cover image at the highest available quality from the result card with one press — fetched through the server so it arrives pristine and full-resolution.",
      },
      {
        icon: ListVideo,
        title: "Playlists in one batch",
        desc: "Paste a link containing a playlist and the system detects it instantly — one press adds every video in the list to the batch queue, converting them one by one with the same format and quality.",
      },
      {
        icon: Layers,
        title: "Per-item trim in the batch",
        desc: "Every item in the batch queue has its own trimmer: set the start and end of a clip for any single item before its conversion starts — the same trimming precision as the main converter.",
      },
    ]
  }
  return [
    {
      icon: Cpu,
      title: "محركان بتجاوب تلقائي",
      desc: "محركا API يعملان بتتابع ذكي: «المحرك 1» يتجاوز تحديات الحماية تلقائيًا، و«المحرك 2» سريع كاحتياط — فشل أحدهما لا يوقف تحويلك أبدًا.",
    },
    {
      icon: Zap,
      title: "سرعة البرق",
      desc: "خط معالجة محسّن ينجز معظم التحويلات خلال دقيقة واحدة، مع بث مباشر لتقدم العملية لحظة بلحظة.",
    },
    {
      icon: AudioLines,
      title: "جودة استوديو",
      desc: "صوت MP3 حتى 320kbps وفيديو MP4 بدقة 1080p — نختار دائمًا أفضل مسار متاح للمصدر.",
    },
    {
      icon: InfinityIcon,
      title: "روابط دائمة",
      desc: "روابطك لا تنتهي ولا تحتاج تجديدًا؛ الملفات تُخزَّن في تخزين خارجي دائم وتُبَث عبر نطاق ELMINYAWE.",
    },
    {
      icon: EyeOff,
      title: "خصوصية كاملة",
      desc: "بدون حسابات، بدون تتبع، وبدون حفظ بياناتك. مساحات العمل المؤقتة تُمحى فور اكتمال الطلب.",
    },
    {
      icon: Server,
      title: "بث فوري",
      desc: "مشغّل مدمج يدعم الاستماع والمشاهدة قبل التنزيل، مع دعم كامل للـ Range Streaming على الأجهزة المحمولة.",
    },
    {
      icon: Smartphone,
      title: "انتقال فوري للهاتف",
      desc: "امسح رمز QR من الشاشة لينتقل رابط التحميل إلى هاتفك فورًا، أو شاركه مباشرة عبر واتساب وتيليجرام — بدون تسجيل دخول.",
    },
    {
      icon: Globe,
      title: "تضمين مرن",
      desc: "مقاطع جاهزة لصفحاتك: مشغّل صوت أو فيديو يعمل بسطر واحد في أي موقع أو مدونة تملكها.",
    },
    {
      icon: Scissors,
      title: "قص المقاطع",
      desc: "استخرج اللحظة التي تريدها فقط: حدد بداية ونهاية النطاق بمقبضين ذهبيين قابلين للسحب على شريط تفاعلي، واحصل على المقطع دون باقي الفيديو.",
    },
    {
      icon: Disc3,
      title: "وسوم ID3 وغلاف تلقائي",
      desc: "كل MP3 يخرج بعنوان الفيديو واسم القناة وغلافه الأصلي مضمّنة داخل الملف — جاهز للمشغّلات وسيارة والهاتف.",
    },
    {
      icon: Clapperboard,
      title: "وسوم MP4 كاملة",
      desc: "ملفات الفيديو أيضًا تحمل هويتها: عنوان الفيديو واسم القناة مضمّنان داخل MP4 بنمط iTunes القياسي — فتظهر في مكتبات الوسائط بالاسم الصحيح.",
    },
    {
      icon: RotateCcw,
      title: "إعادة التحويل بنقرة",
      desc: "من سجل التحويلات أعد أي عملية بنفس الصيغة والجودة بنقرة واحدة — يُملأ الرابط ويبدأ التحويل تلقائيًا دون أي خطوات إضافية.",
    },
    {
      icon: ImageDown,
      title: "تنزيل الغلاف الأصلي",
      desc: "نزّل صورة غلاف الفيديو بأعلى جودة متاحة من بطاقة النتيجة بضغطة واحدة — يمر التنزيل عبر الخادم ليصل بجاهزية ودقة كاملة.",
    },
    {
      icon: ListVideo,
      title: "قوائم التشغيل دفعة واحدة",
      desc: "ألصق رابطًا يحمل قائمة تشغيل وسيكتشفه النظام فورًا — بضغطة واحدة تُضاف كل مقاطع القائمة إلى قائمة الدفعات وتُحوَّل تباعًا بنفس الصيغة والجودة.",
    },
    {
      icon: Layers,
      title: "قص لكل عنصر في الدفعة",
      desc: "كل عنصر في قائمة الدفعات له مقصّه الخاص: حدد بداية ونهاية المقطع لعنصر بعينه قبل بدء تحويله — نفس دقة القص في المحوّل الرئيسي.",
    },
  ]
}

export function Features() {
  const { lang, tr } = useLang()
  const features = featuresFor(lang)
  return (
    <section id="features" className="relative py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow={tr("القدرات · ٠٢", "Capabilities · 02")}
          title={tr("صُمم ليعمل", "Engineered to")}
          highlight={tr("بمستوى احترافي", "a professional standard")}
          description={tr(
            "كل التفاصيل الهندسية التي تتوقعها من أداة فاخرة — وأكثر",
            "Every engineering detail you'd expect from a premium tool — and more"
          )}
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: (i % 3) * 0.1, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="glass glass-hover feature-card group relative rounded-3xl p-6"
            >
              <span className="card-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] transition-colors duration-400 group-hover:border-[#e9a23b]/30 group-hover:bg-[#e9a23b]/[0.08]">
                <feature.icon className="h-5 w-5 text-[#f0c274]" strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 font-display text-base font-bold">{feature.title}</h3>
              <p className="mt-2 text-[13px] leading-7 text-muted-foreground">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- FAQ ---------------- */

function faqsFor(lang: Lang) {
  if (lang === "en") {
    return [
      {
        q: "Are the resulting links permanent?",
        a: "Yes. The file is uploaded once to external storage, and the ELMINYAWE link keeps working for as long as the file is available. The link doesn't depend on your browser session or on the server being mid-run when you open it.",
      },
      {
        q: "What is the maximum file size?",
        a: "The final file is capped at 80MB — enough for most videos up to about an hour at 128kbps audio. Long, high-resolution videos may exceed the cap; you'll see a clear warning before the conversion starts.",
      },
      {
        q: "Why do I need to keep the page open during conversion?",
        a: "Processing happens inside one continuous request: download, encoding, upload, and link verification. If you close the page, everything is cancelled and the temporary files are wiped immediately — that's part of the privacy-by-design approach.",
      },
      {
        q: "Can I convert any video?",
        a: "Only use content you have the right to download and share — such as your own videos or content licensed to you. And if YouTube asks for verification on a video and blocks one engine, the system automatically switches to another external API engine that handles the protection, and the conversion usually completes without any action on your part.",
      },
      {
        q: "Which engines run in the background?",
        a: "Two API engines in a smart sequence: Engine 1 bypasses the smart protection challenge automatically, and Engine 2 follows as a fast backup that takes over instantly if the first fails. The engine in use is shown during the conversion and after it completes, and the server's owner can reorder them or swap the protection-solving service from the server settings.",
      },
      {
        q: "How do I get the file onto my phone?",
        a: "Once the conversion finishes, press the “To phone” button next to the link — a QR code appears; point your phone's camera at it and the download link opens right on the device. You can also share the link via WhatsApp or Telegram with the “Share” button.",
      },
      {
        q: "What's the difference between MP3 qualities?",
        a: "128kbps is ideal for everyday players and smaller files, 192–256kbps is a balanced choice for daily listening, and 320kbps is studio quality, closest to the original source — the best option for archiving and music.",
      },
      {
        q: "Can I save my conversion history or copy all the links at once?",
        a: "Yes — in the “Recent conversions” section you'll find a “Copy links” button that copies every visible result link (filtered however you like) to your clipboard in one go, plus an “Export JSON” button that downloads a complete backup of your history with titles, qualities, engines, sizes, and dates.",
      },
      {
        q: "How can I tell the engines are working before I start?",
        a: "Just above the converter box sits the “Conversion engines” strip — a pulsing green dot means the engine is live and ready, while gray means it isn't currently configured. The strip refreshes automatically every minute, and even if an engine fails mid-conversion, the system jumps straight to the next one.",
      },
      {
        q: "Can I convert only a specific part of the video?",
        a: "Yes — in the “Format & quality” step, open “Trim a specific segment” and type the start and end of the range as minutes:seconds (e.g. 1:30 to 2:15). A golden bar shows where the clip sits along the full video, with the clip length calculated live — and the estimated file size updates automatically so it's accurate for the clip, not the whole video.",
      },
      {
        q: "What data is embedded in the resulting MP3 files?",
        a: "Every MP3 the platform produces automatically carries full ID3 tags: the video title, the channel name (artist), the ELMINYAWE album, and the original YouTube cover art embedded inside the file — so it shows up in your phone or car player with the right name and artwork, with no extra steps from you.",
      },
      {
        q: "Is the data embedded in MP4 files too?",
        a: "Yes — MP4 files ship with the video title, channel name, and tags embedded inside the file in the standard iTunes-style format (via a fast remux with no re-encoding), exactly the way ID3 tags and cover art are embedded in MP3 — so the details show up in video players and media libraries.",
      },
      {
        q: "Can I reconvert something from my history with the same settings?",
        a: "Yes — on any card in “Recent conversions,” hover and press the circular-arrow icon, or open the preview dialog and press “Reconvert.” The link is filled in automatically, the same format and quality are restored, and the conversion starts as soon as the video is recognized — no extra steps.",
      },
      {
        q: "How do I download the video's cover image?",
        a: "After any conversion you'll find a “Cover” button on the result card next to the link buttons — it downloads the original YouTube cover image at the highest available quality (up to maxres) straight through the server, so it arrives pristine, at full original resolution, with no compression.",
      },
      {
        q: "Can I convert an entire playlist?",
        a: "Yes — paste any link carrying a playlist parameter (watch?v=...&list=...) and a golden banner lets you know a playlist was detected. Press “Add playlist to batch” and up to 50 videos are fetched with their titles and thumbnails and dropped into the batch queue, then converted one by one with the format and quality you chose — and you can trim or remove any item before its turn comes.",
      },
      {
        q: "How do I trim a clip from an item in the batch queue?",
        a: "While an item is waiting in the queue, press the scissors icon beside it — a compact trim panel opens that picks up the video duration automatically. Type the range's start and end (e.g. 0:30 to 1:15) and apply; a trim badge appears on the item, and the clip is cut when its turn comes.",
      },
    ]
  }
  return [
    {
      q: "هل الروابط الناتجة دائمة؟",
      a: "نعم. الملف يُرفع مرة واحدة إلى تخزين خارجي، ورابط ELMINYAWE يظل يعمل ما دام الملف متاحًا. لا يعتمد الرابط على جلسة المتصفح أو على تشغيل الخادم لحظة فتحه.",
    },
    {
      q: "ما أقصى حجم للملف؟",
      a: "الحد الأقصى 80 ميجابايت للملف النهائي — يكفي معظم المقاطع حتى نحو ساعة بصوت 128kbps. الفيديوهات الطويلة بدقة عالية قد تتجاوز الحد؛ سترى تنبيهًا واضحًا قبل التحويل.",
    },
    {
      q: "لماذا يجب إبقاء الصفحة مفتوحة أثناء التحويل؟",
      a: "المعالجة تتم ضمن طلب واحد متصل: التنزيل، الترميز، الرفع، والتحقق من الرابط. إذا أغلقت الصفحة يُلغى كل شيء وتُمحى الملفات المؤقتة فورًا — وهذا جزء من تصميم الخصوصية.",
    },
    {
      q: "هل يمكنني تحويل أي فيديو؟",
      a: "استخدم المحتوى الذي تملك حق تنزيله ومشاركته فقط — مثل مقاطعك الخاصة أو المحتوى المرخص لك. وإذا طلب يوتيوب التحقق من فيديو ما وحجب أحد المحركات، ينتقل النظام تلقائيًا إلى محرك API خارجي آخر يتعامل مع الحماية، وغالبًا يكتمل التحويل دون أي تدخل منك.",
    },
    {
      q: "ما المحركات التي تعمل في الخلفية؟",
      a: "محركا API بتتابع ذكي: «المحرك 1» يتجاوز تحدي الحماية الذكي تلقائيًا، و«المحرك 2» سريع كاحتياط يتولى التحويل فورًا إن تعطّل الأول. يظهر لك المحرك المستخدم أثناء التحويل وبعد اكتماله، ويمكن لمالك الخادم ضبط الترتيب أو استبدال خدمة حل الحماية من إعدادات الخادم.",
    },
    {
      q: "كيف أنقل الملف إلى هاتفي؟",
      a: "بعد اكتمال التحويل اضغط زر «للهاتف» بجانب الرابط — سيظهر رمز QR وجّه كاميرا هاتفك إليه لينفتح رابط التحميل مباشرة على الجهاز. يمكنك أيضًا مشاركة الرابط عبر واتساب أو تيليجرام بزر «مشاركة».",
    },
    {
      q: "ما الفرق بين جودات MP3؟",
      a: "128kbps مثالي للمشغلات العادية والملفات الصغيرة، 192-256kbps متوازن للاستماع اليومي، و320kbps هي جودة الاستوديو القريبة من المصدر الأصلي — الأفضل للأرشفة والمقاطع الموسيقية.",
    },
    {
      q: "هل يمكنني حفظ سجل تحويلاتي أو نسخ كل الروابط دفعة واحدة؟",
      a: "نعم — في قسم «آخر التحويلات» ستجد زر «نسخ الروابط» الذي ينسخ كل روابط النتائج الظاهرة (بعد تصفيتها إن رغبت) إلى الحافظة دفعة واحدة، وزر «تصدير JSON» الذي ينزّل نسخة احتياطية كاملة من السجل بالعناوين والجودات والمحركات والأحجام والتواريخ.",
    },
    {
      q: "كيف أعرف أن المحركات تعمل قبل أن أبدأ؟",
      a: "فوق صندوق التحويل مباشرةً يظهر شريط «محركات التحويل» — نقطة خضراء نابضة تعني أن المحرك نشط وجاهز، والرمادي يعني أنه غير مهيأ حاليًا. يتحدث الشريط تلقائيًا كل دقيقة، وحتى لو تعطل محرك أثناء التحويل ينتقل النظام فورًا للمحرك التالي.",
    },
    {
      q: "هل يمكنني تحويل مقطع محدد فقط من الفيديو؟",
      a: "نعم — في خطوة «الصيغة والجودة» افتح «قص مقطع محدد» واكتب بداية ونهاية النطاق بصيغة دقائق:ثواني (مثل 1:30 إلى 2:15). سترى شريطًا ذهبيًا يوضح موضع المقطع على طول الفيديو كاملًا، مع مدة المقطع المحسوبة لحظيًا — ويتحدث تقدير الحجم المتوقع تلقائيًا ليكون دقيقًا للمقطع لا للفيديو كاملًا.",
    },
    {
      q: "ما البيانات المضمنة في ملفات MP3 الناتجة؟",
      a: "كل ملف MP3 يخرج من المنصة يحمل تلقائيًا وسوم ID3 كاملة: عنوان الفيديو، اسم القناة (الفنان)، ألبوم ELMINYAWE، وغلاف الفيديو الأصلي من يوتيوب مضمّنًا داخل الملف — فيظهر في مشغّل هاتفك أو سيارتك بالاسم والصورة الصحيحين دون أي خطوة إضافية منك.",
    },
    {
      q: "هل تُضمّن البيانات في ملفات MP4 أيضًا؟",
      a: "نعم — ملفات MP4 تخرج بعنوان الفيديو واسم القناة والوسوم مضمّنة داخل الملف بنمط iTunes القياسي (عبر إعادة تغليف سريعة دون إعادة ترميز)، تمامًا كما تُضمّن وسوم ID3 والغلاف في MP3 — فتظهر هذه البيانات في مشغّلات الفيديو ومكتبات الوسائط.",
    },
    {
      q: "هل يمكنني إعادة تحويل ملف من السجل بنفس الإعدادات؟",
      a: "نعم — من أي بطاقة في «آخر التحويلات» مرّر المؤشر واضغط أيقونة السهم الدائري، أو افتح نافذة المعاينة واضغط زر «إعادة التحويل». سيُملأ الرابط تلقائيًا وتُستعاد نفس الصيغة والجودة ويبدأ التحويل فور التعرف على الفيديو — دون أي خطوات إضافية.",
    },
    {
      q: "كيف أنزّل صورة غلاف الفيديو؟",
      a: "بعد أي تحويل ستجد زر «الغلاف» في بطاقة النتيجة بجانب أزرار الرابط — يُنزّل صورة الغلاف الأصلية من يوتيوب بأعلى جودة متاحة (حتى maxres) عبر الخادم مباشرةً، لتصل بجاهزية كاملة ودقة أصلية دون ضغط.",
    },
    {
      q: "هل يمكنني تحويل قائمة تشغيل كاملة؟",
      a: "نعم — ألصق أي رابط يحمل معلمة قائمة تشغيل (watch?v=...&list=...) وسيظهر بانر ذهبي يخبرك باكتشاف القائمة. اضغط «أضف القائمة للدفعة» ليُجلب حتى 50 مقطعًا بعناوينها ومصغّراتها وتُضاف كلها لقائمة الدفعات، ثم تُحوَّل تباعًا بنفس الصيغة والجودة التي اخترتها — ويمكنك تعديل أي عنصر أو حذفه قبل وصول دوره.",
    },
    {
      q: "كيف أقص مقطعًا من عنصر داخل قائمة الدفعات؟",
      a: "أثناء انتظار أي عنصر في القائمة اضغط أيقونة المقص بجانبه — ستفتح لوحة قص مصغّرة تعرف مدة الفيديو تلقائيًا. اكتب بداية ونهاية النطاق (مثل 0:30 إلى 1:15) واضغط تطبيقًا؛ سيظهر شارة القص على العنصر ويُقص المقطع عند وصول دوره في التحويل.",
    },
  ]
}

export function Faq() {
  const { lang, tr, isRTL } = useLang()
  const faqs = faqsFor(lang)
  return (
    <section id="faq" className="relative py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHead
          eyebrow={tr("معرفة · ٠٣", "Knowledge · 03")}
          title={tr("الأسئلة", "Frequently asked")}
          highlight={tr("الشائعة", "questions")}
          description={tr(
            "كل ما تحتاج معرفته قبل أول تحويل",
            "Everything you need to know before your first conversion"
          )}
        />

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10"
        >
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="faq-item glass rounded-2xl border-white/8 px-5"
              >
                <AccordionTrigger
                  className={cn(
                    "py-5 text-[14.5px] font-bold leading-7 hover:no-underline [&>svg]:ml-auto",
                    isRTL ? "text-right" : "text-left"
                  )}
                >
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="pb-5 text-[13.5px] leading-9 text-muted-foreground">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  )
}
