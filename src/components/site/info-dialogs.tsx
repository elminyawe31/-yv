"use client"

import { useState } from "react"
import { ShieldCheck, Info } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useLang, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Section { title: string; body: string }

function privacyFor(lang: Lang): Section[] {
  if (lang === "en") {
    return [
      {
        title: "No sign-up, no accounts",
        body: "We never ask for an email, a password, or any personal data. The platform runs sign-up-free from start to finish and ties no identity to your usage.",
      },
      {
        title: "What we keep",
        body: "We keep only a technical log of recent conversions to show you in the “Recent conversions” section: video title, format, quality, size, and the engine that completed the job. You can delete any entry or wipe the whole history at any moment with a single button.",
      },
      {
        title: "Temporary files",
        body: "Files created during a conversion live in a temporary folder on the server and are deleted the moment the request completes. Only the final copy remains, to serve your link.",
      },
      {
        title: "The resulting links",
        body: "The link you receive keeps working for as long as the service is live. When external storage is used, an automatic local mirror is created so it stays fast and always available.",
      },
      {
        title: "Cookies & tracking",
        body: "No tracking cookies, no analytics scripts, and no ads. Your browser keeps only interface preferences (like the batch queue, saved locally on your device).",
      },
    ]
  }
  return [
    {
      title: "لا تسجيل ولا حسابات",
      body: "لا نطلب بريدًا إلكترونيًا ولا كلمة مرور ولا أي بيانات شخصية. المنصة تعمل دون تسجيل من البداية للنهاية، ولا تربط أي هوية بالاستخدام.",
    },
    {
      title: "ما نحتفظ به",
      body: "نحتفظ فقط بسجل تقني لآخر التحويلات لعرضه لك في صفحة «آخر التحويلات»: عنوان الفيديو، الصيغة، الجودة، الحجم، والمحرك الذي أنجز التحويل. يمكنك حذف أي عنصر أو مسح السجل بالكامل في أي لحظة بزر واحد.",
    },
    {
      title: "الملفات المؤقتة",
      body: "تُنشأ الملفات أثناء التحويل في مجلد مؤقت على الخادم وتُحذف فور اكتمال الطلب. النسخة النهائية فقط هي التي تبقى لخدمة رابطك.",
    },
    {
      title: "الروابط الناتجة",
      body: "الرابط الذي تحصل عليه يعمل طالما الخادم يعمل. عند استخدام التخزين الخارجي تُنشأ مرآة محلية تلقائية لضمان بقائه سريعًا ومتاحًا دائمًا.",
    },
    {
      title: "الكوكيز والحقن",
      body: "لا نستخدم كوكيز تتبع ولا سكربتات تحليلية ولا إعلانات. المتصفح يحتفظ فقط بإعدادات الواجهة (مثل قائمة الدفعات المحفوظة محليًا على جهازك).",
    },
  ]
}

function aboutFor(lang: Lang): Section[] {
  if (lang === "en") {
    return [
      {
        title: "What is ELMINYAWE?",
        body: "A premium media converter that turns YouTube videos into instant, direct MP3 and MP4 links with a distinctive, elegant identity. It's built to be the fastest route from link to file — with no extra steps.",
      },
      {
        title: "How does it work?",
        body: "Two API engines run in a smart chain with automatic failover: Engine 1 leads by bypassing the smart protection challenge automatically, and Engine 2 follows as a fast backup. The system tries them in order until the conversion succeeds.",
      },
      {
        title: "The design",
        body: "A dark, Arabic-first glassmorphism interface in an “Obsidian & Gold” palette, with cassette-futurism touches in the live conversion terminal — carefully crafted to look and feel premium on mobile and desktop alike.",
      },
      {
        title: "The limits",
        body: "The only limit is the single-file size — 80MB per file, within the external storage upload cap. There is no storage quota and no conversion-count limit. One conversion is active at a time, and the batch queue converts multiple links one after another automatically.",
      },
    ]
  }
  return [
    {
      title: "ما هي ELMINYAWE؟",
      body: "محوّل وسائط فاخر يحوّل فيديوهات يوتيوب إلى روابط MP3 وMP4 مباشرة فورية بهوية أنيقة مميزة. صُممت لتكون أسرع طريق بين الرابط والملف — بدون خطوات زائدة.",
    },
    {
      title: "كيف تعمل؟",
      body: "يعمل محركا API في سلسلة ذكية مع تجاوب تلقائي عند الفشل: «المحرك 1» يتصدر بتجاوز تحدي الحماية الذكي تلقائيًا، و«المحرك 2» سريع كاحتياط. النظام يجرّبهما بالترتيب حتى ينجح التحويل.",
    },
    {
      title: "التصميم",
      body: "واجهة عربية داكنة بثيم زجاجي (Glassmorphism) بلوحة «الأوبسيديان والذهب» مع لمسات Cassette Futurism في طرفية التحويل الحية — مبنية بعناية لتبدو حرفية وسلسة على الجوال وسطح المكتب.",
    },
    {
      title: "الحدود",
      body: "الحد الوحيد هو حجم الملف الواحد — 80MB لكل ملف ضمن سقف الرفع للتخزين الخارجي. لا توجد حصة تخزين ولا حد لعدد التحويلات. تحويل واحد نشط في اللحظة نفسها، وقائمة الدفعات تحوّل عدة روابط واحدًا تلو الآخر تلقائيًا.",
    },
  ]
}

function InfoDialog({ open, onOpenChange, icon: Icon, title, desc, sections }:
{
  open: boolean
  onOpenChange: (v: boolean) => void
  icon: typeof ShieldCheck
  title: string
  desc: string
  sections: Section[]
}) {
  const { isRTL } = useLang()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="glass-deep max-h-[85vh] max-w-lg gap-0 overflow-y-auto rounded-3xl border-white/10 p-0"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <div className="gold-ring relative p-6 pb-5">
          <DialogHeader className={cn("space-y-2", isRTL ? "text-right" : "text-left")}>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e9a23b]/12 text-[#f0c274]">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div>
                <DialogTitle className="font-display text-base font-bold">{title}</DialogTitle>
                <DialogDescription className="text-[11.5px]">{desc}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="divider-gold my-5" />
          <div className="flex flex-col gap-4">
            {sections.map((s) => (
              <div key={s.title}>
                <h4 className="flex items-center gap-2 text-[13.5px] font-bold text-[#f0c274]">
                  <span className="h-1 w-1 rotate-45 bg-[#e9a23b] shadow-[0_0_6px_rgba(233,162,59,0.6)]" aria-hidden="true" />
                  {s.title}
                </h4>
                <p className={cn("mt-1.5 text-[13px] leading-7 text-muted-foreground", isRTL ? "pr-3.5" : "pl-3.5")}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function InfoDialogs() {
  const { lang, tr } = useLang()
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-[#f0c274]"
        >
          <Info className="h-3.5 w-3.5" />
          {tr("عن المنصة", "About")}
        </button>
        <span className="h-3 w-px bg-white/10" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setPrivacyOpen(true)}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-[#f0c274]"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {tr("الخصوصية", "Privacy")}
        </button>
      </div>

      <InfoDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        icon={Info}
        title={tr("عن منصة ELMINYAWE", "About ELMINYAWE")}
        desc={tr("محوّل وسائط فاخر — من يوتيوب إلى رابط مباشر", "Premium media converter — YouTube to a direct link")}
        sections={aboutFor(lang)}
      />
      <InfoDialog
        open={privacyOpen}
        onOpenChange={setPrivacyOpen}
        icon={ShieldCheck}
        title={tr("سياسة الخصوصية", "Privacy Policy")}
        desc={tr("خصوصيتك مبنية في التصميم — ليست صفحة مُلحقة", "Privacy built into the design — not a bolt-on page")}
        sections={privacyFor(lang)}
      />
    </>
  )
}
