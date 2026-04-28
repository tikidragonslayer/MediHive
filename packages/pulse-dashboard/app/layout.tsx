import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "MediPulse — Medi-Hive Command Center",
  description: "Blockchain-anchored hospital management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-gray-950 text-white">
        {/* HIPAA Disclaimer Banner — visible to grant reviewers */}
        <div className="bg-amber-900/80 border-b border-amber-700 px-4 py-2 text-center text-xs text-amber-200 flex items-center justify-center gap-2 flex-shrink-0">
          <span className="font-bold uppercase tracking-wider">Demo Environment</span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">All patient data is simulated. No real PHI is stored or transmitted.</span>
          <span className="sm:hidden">Simulated data only — no real PHI.</span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline font-medium">HIPAA-compliant architecture — not a production system.</span>
        </div>
        {children}
        {/* Fixed demo watermark — bottom right */}
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-400 pointer-events-none select-none shadow-lg">
          <span className="font-semibold text-amber-400">DEMO</span> — Simulated Data Only
        </div>
      </body>
    </html>
  );
}
