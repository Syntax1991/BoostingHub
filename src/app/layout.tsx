import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { APP_BRAND_NAME, APP_BRAND_TAGLINE } from "@/lib/branding";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: APP_BRAND_NAME,
    template: `${APP_BRAND_NAME} · %s`,
  },
  description: APP_BRAND_TAGLINE,
};

/**
 * The app is dark-only. Declaring it (`<meta name="color-scheme" content="dark">`)
 * stops browsers' auto-dark / "force dark pages" modes (e.g. Opera GX) from
 * recoloring it — they otherwise lighten the dark borders to near-white.
 */
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0c0e12",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full dark`}>
      <body className="min-h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
