// app/api/admin/create/partner/route.ts
// Admin-assisted partner account creation wizard
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const {
    name,
    email,
    phone,
    business_name,
    business_type,
    slug,
    subscription_tier,
    notes,
    services,         // array of { name, description, price_cents }
  } = await req.json()

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Create partner record
  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .insert({
      name,
      email,
      phone: phone ?? null,
      business_name: business_name ?? name,
      business_type: business_type ?? null,
      slug: slug ?? email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
      subscription_tier: subscription_tier ?? 'basic',
      notes: notes ?? null,
      active: true,
    })
    .select()
    .single()

  if (partnerErr) {
    if (partnerErr.code === '23505') {
      return NextResponse.json({ error: 'Email or slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: partnerErr.message }, { status: 500 })
  }

  // Create initial services if provided
  let createdServices: any[] = []
  if (services && Array.isArray(services) && services.length > 0) {
    const serviceInserts = services.map((s: any) => ({
      partner_id: partner.id,
      name: s.name,
      description: s.description ?? null,
      price_cents: s.price_cents ?? 0,
      active: true,
    }))

    const { data: svcData, error: svcErr } = await supabase
      .from('services')
      .insert(serviceInserts)
      .select()

    if (!svcErr) createdServices = svcData ?? []
  }

  await logAdminAction(admin.userId, 'create_partner', 'partner', partner.id, {
    name,
    email,
    serviceCount: createdServices.length,
  })

  return NextResponse.json({ partner, services: createdServices }, { status: 201 })
}
