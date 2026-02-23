import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getOrCreateUser } from "@/lib/auth";
import { TimePreferenceProvider } from "@/components/providers/time-preference-provider";
import { UnitsPreferenceProvider } from "@/components/providers/units-preference-provider";
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
  title: "HashTracks",
  description: "The Strava of Hashing — discover runs, track attendance, view stats.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getOrCreateUser();
  const timeDisplayPref = user?.timeDisplayPref ?? "EVENT_LOCAL";

  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <TooltipProvider>
            <TimePreferenceProvider initialPreference={timeDisplayPref}>
              <UnitsPreferenceProvider>
                <Header />
                <main className="mx-auto min-h-[calc(100vh-8rem)] max-w-7xl px-4 py-8">
                  {children}
                </main>
                <Footer />
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
