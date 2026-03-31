import type { Metadata, Viewport } from "next";
import { Outfit, Sora, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { PostHogIdentify } from "@/components/providers/posthog-identify";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getOrCreateUser } from "@/lib/auth";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { buildWebSiteJsonLd } from "@/lib/seo";
import { TimePreferenceProvider } from "@/components/providers/time-preference-provider";
import { UnitsPreferenceProvider } from "@/components/providers/units-preference-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz"),
  title: "HashTracks",
  description: "Discover runs, track attendance, view stats — the hareline you never knew you needed.",
  openGraph: {
    type: "website",
    siteName: "HashTracks",
    title: "HashTracks",
    description: "Discover runs, track attendance, view stats — the hareline you never knew you needed.",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getOrCreateUser();
  const timeDisplayPref = user?.timeDisplayPref ?? "EVENT_LOCAL";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  const websiteJsonLd = buildWebSiteJsonLd(baseUrl);

  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
          />
        </head>
        <body
          className={`${outfit.variable} ${sora.variable} ${jetbrainsMono.variable} antialiased`}
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm focus:font-medium"
          >
            Skip to main content
          </a>
          <PostHogProvider>
          <PostHogIdentify />
          <TooltipProvider>
            <TimePreferenceProvider initialPreference={timeDisplayPref}>
              <UnitsPreferenceProvider>
                <ThemeProvider>
                <Header />
                <main id="main-content" tabIndex={-1} className="mx-auto min-h-[calc(100vh-8rem)] max-w-7xl px-4 py-8 pb-24 md:pb-8 focus:outline-none">
                  {children}
                </main>
                <Footer />
                <MobileBottomNav />
                <Toaster />
                </ThemeProvider>
              </UnitsPreferenceProvider>
            </TimePreferenceProvider>
          </TooltipProvider>
          <SpeedInsights />
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
