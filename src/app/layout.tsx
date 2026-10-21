import type { Metadata, Viewport } from "next";
import { Alexandria, IBM_Plex_Sans_Arabic, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

/* Font-weight audit (2026-10): Alexandria renders ONLY bold/extrabold,
 * IBM Plex Sans Arabic never uses 300, JetBrains Mono needs 400/500/700.
 * Trimming the unused weights saves 4 font files off the critical path. */
const display = Alexandria({
  variable: "--font-display",
  subsets: ["arabic", "latin"],
  weight: ["700", "800"],
});

const body = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

/* OG/metadata base — resolve the REAL deployment origin instead of the
 * hard-coded localhost (which produced localhost OG URLs on Vercel). */
const siteOrigin =
  process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: "ELMINYAWE — Premium Media Converter | Direct MP3 & MP4 Links",
  description:
    "Convert any YouTube video into studio-quality MP3 or high-resolution MP4 and get an instant direct link from the ELMINYAWE domain. No sign-up, no queues — instant streaming and permanent links.",
  keywords: ["ELMINYAWE", "YouTube converter", "MP3", "MP4", "direct link", "media converter", "تحويل فيديو", "رابط مباشر"],
  applicationName: "ELMINYAWE",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "ELMINYAWE — Premium Media Converter",
    description: "Convert any video into an instant direct MP3 or MP4 link — powered by ELMINYAWE.",
    type: "website",
    locale: "ar_EG",
    alternateLocale: ["en_US"],
    siteName: "ELMINYAWE",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "ELMINYAWE — Premium Media Converter",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ELMINYAWE — Premium Media Converter",
    description: "Convert any video into an instant direct MP3 or MP4 link — powered by ELMINYAWE.",
    images: ["/og-image.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ELMINYAWE",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#070709",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} antialiased bg-background text-foreground`}
      >
        {/* Gold-ring animation plumbing (@property + keyframes), served inline:
            the CSS optimizer warns about the modern @property at-rule while all
            current browsers support it — inline keeps the build log clean. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              '@property --gold-angle{syntax:"<angle>";inherits:false;initial-value:0deg}@keyframes gold-ring-rotate{to{--gold-angle:360deg}}',
          }}
        />
        {/* Warm up the two external origins the page actually pulls from:
            YouTube thumbnails (i.ytimg.com) and the media storage (catbox). */}
        <link rel="preconnect" href="https://i.ytimg.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://files.catbox.moe" crossOrigin="anonymous" />
        {children}
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  );
}
