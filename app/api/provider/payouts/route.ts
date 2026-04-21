// app/api/provider/payouts/route.ts
// Provider payout history
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get('provider_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  if (!providerId) {
    return NextResponse.json({ error: 'provider_id required' }, { status: 400 })
  }

  let query = supabase
    .from('payment_splits')
    .select(
      `id, created_at, total_cents, provider_share_cents, status,
       booking:booking_id(id, reference, scheduled_at, partner:partner_id(name, business_name), service:service_id(name))`,
      { count: 'exact' }
    )
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totalPaid = (data ?? [])
    .filter((s: any) => s.status === 'settled')
    .reduce((sum: number, s: any) => sum + (s.provider_share_cents ?? 0), 0)

  const pendingAmount = (data ?? [])
    .filter((s: any) => s.status === 'pending')
    .reduce((sum: number, s: any) => sum + (s.provider_share_cents ?? 0), 0)

  return NextResponse.json({
    providerId,
    totalPaid,
    pendingAmount,
    payouts: data,
    total: count,
  })
}
