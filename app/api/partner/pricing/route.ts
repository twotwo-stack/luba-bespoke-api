// app/api/partner/pricing/route.ts
// Partner requests a price change (goes into approval queue)
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const partnerId = searchParams.get('partner_id')

  if (!partnerId) {
    return NextResponse.json({ error: 'partner_id required' }, { status: 400 })
  }

  // Get partner's services with current prices
  const { data: services, error: svcErr } = await supabase
    .from('services')
    .select('id, name, description, price_cents, active')
    .eq('partner_id', partnerId)
    .order('name')

  if (svcErr) return NextResponse.json({ error: svcErr.message }, { status: 500 })

  // Get pending price change requests for this partner
  const { data: pending } = await supabase
    .from('pending_price_changes')
    .select('id, entity_id, current_price, requested_price, reason, status, created_at, reviewed_at, review_notes')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ services, pendingChanges: pending ?? [] })
}

export async function POST(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const { partner_id, service_id, requested_price, reason } = await req.json()

  if (!partner_id || !service_id || !requested_price) {
    return NextResponse.json({ error: 'partner_id, service_id, and requested_price are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify service belongs to this partner and get current price
  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, name, price_cents, partner_id')
    .eq('id', service_id)
    .eq('partner_id', partner_id)
    .single()

  if (svcErr || !service) {
    return NextResponse.json({ error: 'Service not found for this partner' }, { status: 404 })
  }

  // Check for existing pending request on this service
  const { data: existing } = await supabase
    .from('pending_price_changes')
    .select('id')
    .eq('entity_id', service_id)
    .eq('partner_id', partner_id)
    .eq('status', 'pending')
    .single()

  if (existing) {
    return NextResponse.json({ error: 'A pending price change request already exists for this service' }, { status: 409 })
  }

  const { data: priceChange, error } = await supabase
    .from('pending_price_changes')
    .insert({
      entity_type: 'service',
      entity_id: service_id,
      partner_id,
      current_price: service.price_cents,
      requested_price,
      reason: reason ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ priceChange }, { status: 201 })
}
