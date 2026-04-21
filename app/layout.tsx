// app/layout.tsx -- required by Next.js 14 App Router
export const metadata = { title: 'Luba Bespoke API', description: 'API-only deployment' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
