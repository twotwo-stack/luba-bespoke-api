// app/api/admin/pricing/route.ts
// Services and partner pricing with approval queue
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

// GET /api/admin/pricing -- list services and pending price change requests
export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'services' // 'services' | 'pending'

  if (view === 'pending') {
    const { data, error } = await supabase
      .from('pending_price_changes')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ pendingChanges: data })
  }

  // Default: services list
  const { data: services, error } = await supabase
    .from('services')
    .select('id, name, description, price_cents, active, partner:partner_id(id, name, business_name)')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ services })
}

// PATCH /api/admin/pricing -- update service price directly (admin) or approve/reject pending change
export async function PATCH(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const { action, id, price_cents, review_notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = createServiceClient()

  // Approve or reject pending price change
  if (action === 'approve' || action === 'reject') {
    const { data: pending, error: fetchErr } = await supabase
      .from('pending_price_changes')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchErr || !pending) return NextResponse.json({ error: 'Price change not found' }, { status: 404 })
    if (pending.status !== 'pending') return NextResponse.json({ error: 'Already reviewed' }, { status: 409 })

    const newStatus = action === 'approve' ? 'approved' : 'rejected'

    if (action === 'approve' && pending.entity_type === 'service') {
      await supabase
        .from('services')
        .update({ price_cents: pending.requested_price })
        .eq('id', pending.entity_id)
    }

    await supabase.from('pending_price_changes').update({
      status: newStatus,
      reviewed_by: admin.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: review_notes ?? null,
    }).eq('id', id)

    await logAdminAction(admin.userId, `price_change_${newStatus}`, 'pending_price_change', id, { action })
    return NextResponse.json({ success: true, status: newStatus })
  }

  // Direct price update for a service
  if (!price_cents || typeof price_cents !== 'number') {
    return NextResponse.json({ error: 'price_cents required for direct update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('services')
    .update({ price_cents })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'update_service_price', 'service', id, { price_cents })
  return NextResponse.json({ service: data })
}

// POST /api/admin/pricing -- submit a price change request (partner-initiated via admin proxy)
export async function POST(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const { entity_type, entity_id, partner_id, partner_email, current_price, requested_price, reason } = await req.json()

  if (!entity_type || !entity_id || !current_price || !requested_price) {
    return NextResponse.json({ error: 'entity_type, entity_id, current_price, requested_price required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('pending_price_changes')
    .insert({
      entity_type,
      entity_id,
      partner_id: partner_id ?? null,
      partner_email: partner_email ?? null,
      current_price,
      requested_price,
      reason: reason ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'create_price_change_request', entity_type, entity_id, { requested_price })
  return NextResponse.json({ priceChange: data }, { status: 201 })
}
