// app/api/provider/reviews/route.ts
// Provider-facing review list for jobs they completed
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get('provider_id')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  if (!providerId) {
    return NextResponse.json({ error: 'provider_id required' }, { status: 400 })
  }

  const { data, error, count } = await supabase
    .from('reviews')
    .select(
      `id, created_at, rating, comment,
       booking:booking_id(id, reference, scheduled_at, service:service_id(name), partner:partner_id(name, business_name))`,
      { count: 'exact' }
    )
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const avgRating = data && data.length > 0
    ? data.reduce((sum: number, r: any) => sum + (r.rating ?? 0), 0) / data.length
    : null

  return NextResponse.json({ reviews: data, total: count, averageRating: avgRating })
}
