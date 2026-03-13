import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dashboard Sites — Region Lovers',
  description: 'Pilotage de la performance des sites Region Lovers',
  icons: {
    icon: [
      { url: '/favicon.ico',  sizes: 'any' },
      { url: '/favicon.png',  type: 'image/png', sizes: '32x32' },
      { url: '/icon.png',     type: 'image/png', sizes: '32x32' },
    ],
    apple: { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased bg-gray-50">
        {children}
      </body>
    </html>
  );
}
