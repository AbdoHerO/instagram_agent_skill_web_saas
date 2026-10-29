import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Instagram Studio · Euro Digital', template: '%s · Instagram Studio' },
  description: 'Instagram content studio for Euro Digital: AI drafts, human approval, official publishing.',
  robots: { index: false, follow: false },
};

// The interface is English for now; `lang`/`dir` are the hooks for French and Arabic later.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
