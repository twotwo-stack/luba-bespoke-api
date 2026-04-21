// app/api/admin/overview/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()

  const [
    { count: totalPartners },
    { count: totalProviders },
    { count: totalUsers },
    { count: totalBookings },
    { count: pendingBugs },
    { count: pendingPriceChanges },
  ] = await Promise.all([
    supabase.from('partners').select('*', { count: 'exact', head: true }),
    supabase.from('providers').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('bookings').select('*', { count: 'exact', head: true }),
    supabase.from('bugs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('pending_price_changes').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  // Recent bookings (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recentBookings } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', thirtyDaysAgo)

  return NextResponse.json({
    stats: {
      totalPartners: totalPartners ?? 0,
      totalProviders: totalProviders ?? 0,
      totalUsers: totalUsers ?? 0,
      totalBookings: totalBookings ?? 0,
      recentBookings: recentBookings ?? 0,
      pendingBugs: pendingBugs ?? 0,
      pendingPriceChanges: pendingPriceChanges ?? 0,
    },
  })
}
