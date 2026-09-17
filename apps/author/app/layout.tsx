import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Wayfinder Author" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-dvh flex-col bg-neutral-50 text-neutral-900 antialiased">
        <header className="flex h-10 shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-4 text-sm">
          <Link href="/" className="font-semibold text-berkeley-blue">
            Wayfinder Author
          </Link>
          <span className="text-neutral-400">local only</span>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
