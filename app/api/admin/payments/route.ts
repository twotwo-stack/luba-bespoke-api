// app/api/admin/payments/route.ts
// Stripe reconciliation, Stripe Connect payouts, 50/50 partner splits
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

// GET /api/admin/payments -- payment summary and recent transactions
export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'transactions' // 'transactions' | 'payouts' | 'splits'
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  if (view === 'payouts') {
    let query = supabase
      .from('payouts')
      .select(
        `id, created_at, amount_cents, status, stripe_transfer_id,
         partner:partner_id(id, name, business_name)`,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ payouts: data, total: count })
  }

  if (view === 'splits') {
    let query = supabase
      .from('payment_splits')
      .select(
        `id, created_at, booking_id, total_cents, platform_share_cents, partner_share_cents, provider_share_cents, status,
         booking:booking_id(reference, partner:partner_id(name))`,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ splits: data, total: count })
  }

  // Default: transactions
  let query = supabase
    .from('payments')
    .select(
      `id, created_at, amount_cents, status, stripe_payment_intent_id, stripe_charge_id,
       booking:booking_id(id, reference, partner:partner_id(name))`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate totals
  const { data: totals } = await supabase
    .from('payments')
    .select('amount_cents, status')

  const summary = (totals ?? []).reduce(
    (acc, p) => {
      if (p.status === 'succeeded') acc.collected += p.amount_cents
      if (p.status === 'refunded') acc.refunded += p.amount_cents
      acc.total++
      return acc
    },
    { collected: 0, refunded: 0, total: 0 }
  )

  return NextResponse.json({ payments: data, total: count, summary })
}

// POST /api/admin/payments -- trigger manual payout to partner via Stripe Connect
export async function POST(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin'])
  if (!admin) return adminAuthError()

  const { partner_id, amount_cents, description } = await req.json()
  if (!partner_id || !amount_cents) {
    return NextResponse.json({ error: 'partner_id and amount_cents required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch partner Stripe Connect account
  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select('id, name, stripe_connect_account_id')
    .eq('id', partner_id)
    .single()

  if (partnerErr || !partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  if (!partner.stripe_connect_account_id) {
    return NextResponse.json({ error: 'Partner has no Stripe Connect account' }, { status: 422 })
  }

  // Record payout intent (actual Stripe transfer requires Stripe SDK -- log as pending for manual execution or webhook)
  const { data: payout, error } = await supabase
    .from('payouts')
    .insert({
      partner_id,
      amount_cents,
      status: 'pending',
      description: description ?? `Manual payout initiated by admin`,
      initiated_by: admin.userId,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'initiate_payout', 'partner', partner_id, { amount_cents })
  return NextResponse.json({ payout }, { status: 201 })
}
