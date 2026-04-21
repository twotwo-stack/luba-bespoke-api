// app/api/admin/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const partnerId = searchParams.get('partner_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('bookings')
    .select(
      `id, created_at, status, reference, total_cents, scheduled_at, notes,
       partner:partner_id(id, name, business_name),
       provider:provider_id(id, name),
       user:user_id(id, name, email)`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (partnerId) query = query.eq('partner_id', partnerId)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ bookings: data, total: count })
}

export async function PATCH(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const { id, status, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, any> = {}
  if (status) updates.status = status
  if (notes !== undefined) updates.notes = notes

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'update_booking', 'booking', id, updates)
  return NextResponse.json({ booking: data })
}
