// app/api/partner/earnings/route.ts
// Partner earnings summary and breakdown
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  // Allow admin or partner JWT (partners call this for themselves)
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const partnerId = searchParams.get('partner_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!partnerId) {
    return NextResponse.json({ error: 'partner_id required' }, { status: 400 })
  }

  // Restrict non-admins to their own data (future: partner self-auth)
  // For now: all callers are admin-level from admin_roles

  let query = supabase
    .from('payment_splits')
    .select(
      `id, created_at, total_cents, platform_share_cents, partner_share_cents, provider_share_cents, status,
       booking:booking_id(id, reference, scheduled_at, service:service_id(name))`
    )
    .eq('partner_id', partnerId)
    .eq('status', 'settled')
    .order('created_at', { ascending: false })

  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totalEarned = (data ?? []).reduce((sum, s) => sum + (s.partner_share_cents ?? 0), 0)
  const totalBookings = data?.length ?? 0

  // Pending (not yet settled)
  const { data: pending } = await supabase
    .from('payment_splits')
    .select('partner_share_cents')
    .eq('partner_id', partnerId)
    .eq('status', 'pending')

  const pendingAmount = (pending ?? []).reduce((sum, s) => sum + (s.partner_share_cents ?? 0), 0)

  return NextResponse.json({
    partnerId,
    totalEarned,
    pendingAmount,
    totalBookings,
    splits: data,
  })
}
