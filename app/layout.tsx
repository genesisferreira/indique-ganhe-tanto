import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppProviders } from '@/components/providers'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Indique e Ganhe | Tanto Telecom',
  applicationName: 'Indique e Ganhe — Tanto Telecom',
  description: 'Programa de indicações da Tanto Telecom. Indique amigos e ganhe recompensas!',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/branding/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/tanto-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/tanto-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/tanto-apple-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" className="dark bg-background">
      <body className="font-sans antialiased min-h-screen">
        <AppProviders>{children}</AppProviders>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
