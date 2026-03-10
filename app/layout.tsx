import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ruh-roh. halp.",
  description: "Multi-AI productivity orchestration command center.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
