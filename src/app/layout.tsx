import { Fraunces, IBM_Plex_Mono, Literata } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const text = Literata({
  subsets: ["latin"],
  variable: "--font-text",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Notepad",
  description: "A shared plain-text note that stays on the devices that open it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${text.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
