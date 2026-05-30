import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Emet | IADC Therapist',
  description: 'Induced After-Death Communication therapy powered by AI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}
