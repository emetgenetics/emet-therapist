import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Emet | IADC Therapist AI',
  description: 'Induced After-Death Communication therapy powered by AI. A safe space for healing and connection.',
  keywords: ['IADC', 'therapy', 'grief', 'healing', 'AI therapist', 'EMDR', 'bilateral stimulation'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-slate-950 text-slate-100 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
