// lib/admin-auth.ts
// Admin auth middleware for luba-bespoke-api.
// Validates Supabase JWT Bearer token and checks admin_roles table.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase/service'

export type BespokeAdminRole = 'master' | 'super_admin' | 'admin' | 'engineer'

export interface BespokeAdminContext {
  userId: string
  email: string | null
  role: BespokeAdminRole
}

export function adminAuthError(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export async function requireBespokeAdminAuth(
  req: NextRequest,
  allowedRoles: BespokeAdminRole[] = ['master', 'super_admin', 'admin', 'engineer']
): Promise<BespokeAdminContext | null> {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()

  if (!token) return null

  try {
    // Verify JWT using Supabase anon client
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const { data: { user }, error } = await anonClient.auth.getUser(token)
    if (error || !user) return null

    // Check admin_roles
    const supabase = createServiceClient()
    const { data: roleRecord } = await supabase
      .from('admin_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!roleRecord) return null
    if (!allowedRoles.includes(roleRecord.role as BespokeAdminRole)) return null

    return { userId: user.id, email: user.email ?? null, role: roleRecord.role as BespokeAdminRole }
  } catch {
    return null
  }
}

export async function logAdminAction(
  actorId: string,
  action: string,
  entityType: string | null,
  entityId: string | null,
  details: Record<string, any> | null = null
) {
  try {
    const supabase = createServiceClient()
    await supabase.from('admin_audit_log').insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    })
  } catch {}
}
