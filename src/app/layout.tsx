import type { Viewport } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getOrCreateUser } from "@/lib/auth";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { TimePreferenceProvider } from "@/components/providers/time-preference-provider";
import { UnitsPreferenceProvider } from "@/components/providers/units-preference-provider";
import { getRootMetadata } from "@/lib/seo";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata = getRootMetadata();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getOrCreateUser();
  const timeDisplayPref = user?.timeDisplayPref ?? "EVENT_LOCAL";

  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en">
        <body
          className={`${outfit.variable} ${jetbrainsMono.variable} antialiased`}
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm focus:font-medium"
          >
            Skip to main content
          </a>
          <TooltipProvider>
            <TimePreferenceProvider initialPreference={timeDisplayPref}>
              <UnitsPreferenceProvider>
                <Header />
                <main id="main-content" tabIndex={-1} className="mx-auto min-h-[calc(100vh-8rem)] max-w-7xl px-4 py-8 pb-24 md:pb-8 focus:outline-none">
                  {children}
                </main>
                <Footer />
                <MobileBottomNav />
                <Toaster />
              </UnitsPreferenceProvider>
            </TimePreferenceProvider>
          </TooltipProvider>
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
