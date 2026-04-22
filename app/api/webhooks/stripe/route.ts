// app/api/webhooks/stripe/route.ts
//
// Stripe webhook receiver for Luba Bespoke.
// Verifies signature, logs every event to admin_audit_log, returns 200.
//
// Events handled:
//   payment_intent.succeeded       — guest payment captured
//   payment_intent.payment_failed  — guest payment failed
//   charge.refunded                — refund issued
//   transfer.paid                  — provider/partner payout settled
//   account.updated                — Stripe Connect account status change
//
// Business logic (split updates, payout triggers) is deferred to a later
// milestone. This endpoint exists so Stripe can be configured to send live
// events and every received event is durably logged.
//
// Register endpoint in Stripe dashboard:
//   https://dashboard.stripe.com/webhooks → Add endpoint
//   URL: https://luba-bespoke-api.vercel.app/api/webhooks/stripe
//   Events: the five listed above (plus any others desired)

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase/service'

// ── Stripe init ───────────────────────────────────────────────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-03-25.dahlia' })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logWebhookEvent(
  eventType: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('admin_audit_log').insert({
      actor_id:    'stripe-webhook',
      actor_email: 'stripe@webhook',
      action:      eventType,
      entity_type: entityType,
      entity_id:   entityId,
      details,
    })
  } catch (err) {
    // Never let an audit-log failure block the 200 response to Stripe
    console.error('[stripe-webhook] audit log failed:', err)
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  await logWebhookEvent(
    'payment_intent.succeeded',
    'payment_intent',
    pi.id,
    {
      amount:   pi.amount,
      currency: pi.currency,
      customer: pi.customer,
      metadata: pi.metadata,
    }
  )
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  await logWebhookEvent(
    'payment_intent.payment_failed',
    'payment_intent',
    pi.id,
    {
      amount:            pi.amount,
      currency:          pi.currency,
      last_payment_error: pi.last_payment_error?.message ?? null,
      customer:          pi.customer,
      metadata:          pi.metadata,
    }
  )
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  await logWebhookEvent(
    'charge.refunded',
    'charge',
    charge.id,
    {
      amount_refunded: charge.amount_refunded,
      currency:        charge.currency,
      payment_intent:  charge.payment_intent,
      metadata:        charge.metadata,
    }
  )
}

async function handleTransferPaid(transfer: Stripe.Transfer) {
  await logWebhookEvent(
    'transfer.paid',
    'transfer',
    transfer.id,
    {
      amount:      transfer.amount,
      currency:    transfer.currency,
      destination: transfer.destination,
      metadata:    transfer.metadata,
    }
  )
}

async function handleAccountUpdated(account: Stripe.Account) {
  await logWebhookEvent(
    'account.updated',
    'stripe_account',
    account.id,
    {
      charges_enabled:  account.charges_enabled,
      payouts_enabled:  account.payouts_enabled,
      details_submitted: account.details_submitted,
      email:            account.email,
    }
  )
}

// ── Route handler ─────────────────────────────────────────────────────────────

// Disable body parsing — Stripe signature verification requires the raw body
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // Read raw body for signature verification
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[stripe-webhook] signature verification failed:', message)
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 })
  }

  // Dispatch to typed handler
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
        break

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
        break

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge)
        break

      case 'transfer.paid':
        await handleTransferPaid(event.data.object as Stripe.Transfer)
        break

      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account)
        break

      default:
        // Log unhandled events at info level — don't error, Stripe needs a 200
        await logWebhookEvent(
          event.type,
          'stripe_event',
          event.id,
          { livemode: event.livemode }
        )
        break
    }
  } catch (err) {
    // Handler errors are logged but don't affect the 200 response to Stripe.
    // Stripe will not retry on a 2xx, so we only return non-2xx for signature failures.
    console.error(`[stripe-webhook] handler error for ${event.type}:`, err)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
