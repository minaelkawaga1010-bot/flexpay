import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlexPay - AI-Powered Digital Wallet for UAE",
  description:
    "Smart digital wallet platform for migrant workers in the UAE. Send money, save smart, build credit, and earn loyalty rewards.",
  keywords: [
    "FlexPay",
    "digital wallet",
    "UAE",
    "migrant workers",
    "remittance",
    "savings",
    "credit score",
  ],
  authors: [{ name: "FlexPay Team" }],
  icons: {
    icon: "/flexpay-logo.png",
  },
  openGraph: {
    title: "FlexPay - AI-Powered Digital Wallet for UAE",
    description:
      "Smart digital wallet platform for migrant workers in the UAE",
    siteName: "FlexPay",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
