import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { SessionProvider } from 'next-auth/react';
import './globals.css';

export const metadata: Metadata = {
  title: 'RADR.',
  description:
    'Parse a job description, run approved X-Ray queries across LinkedIn, GitHub, Stack Overflow, Wellfound, Behance, Dribbble, Xing and the open web, index every profile returned, and track outreach.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-canvas text-ink">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
