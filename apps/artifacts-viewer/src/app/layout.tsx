import './globals.css';
import { Inter, Source_Serif_4 } from 'next/font/google';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

// The distinctive serif touch for page-level H1 titles only (new-prompt.md §2) —
// everything else in the app stays on the sans-serif (Inter) stack. (Lora's default
// space glyph reads unusually wide at bold weight; Source Serif 4 doesn't have that problem.)
const serif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-page-serif',
  display: 'swap',
});

export const metadata = {
  title: 'Dynamic UI',
  description: 'An AI-native workspace: chat to build pages or query your data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
