import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PLANS = {
  pro_monthly: {
    name: 'Pro Monthly',
    amount: 250000, // ₦2,500 in kobo
    interval: 'monthly'
  },
  pro_yearly: {
    name: 'Pro Yearly',
    amount: 2500000, // ₦25,000 in kobo
    interval: 'yearly'
  }
};

// Initialize payment
export async function POST(request) {
  try {
    const { userId, email, planType } = await request.json();

    if (!userId || !email || !planType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400, headers: corsHeaders }
      );
    }

    const plan = PLANS[planType];
    if (!plan) {
      return NextResponse.json(
        { error: 'Invalid plan type' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Initialize Paystack transaction
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        amount: plan.amount,
        currency: 'NGN',
        reference: `AIDANNA_${Date.now()}_${userId.slice(0, 8)}`,
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/callback`,
        metadata: {
          userId: userId,
          planType: planType,
          interval: plan.interval,
          custom_fields: [
            {
              display_name: 'User ID',
              variable_name: 'user_id',
              value: userId
            },
            {
              display_name: 'Plan',
              variable_name: 'plan',
              value: plan.name
            }
          ]
        }
      })
    });

    const data = await response.json();

    if (!data.status) {
      throw new Error(data.message || 'Payment initialization failed');
    }

    // Save payment record
    await supabase.from('payment_history').insert({
      user_id: userId,
      amount: plan.amount / 100,
      currency: 'NGN',
      paystack_reference: data.data.reference,
      status: 'pending',
      plan_type: planType,
      billing_cycle: plan.interval
    });

    return NextResponse.json({
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference
    }, {
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Payment initialization error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to initialize payment' },
      { status: 500, headers: corsHeaders }
    );
  }
}

// Verify payment
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const reference = searchParams.get('reference');

    if (!reference) {
      return NextResponse.json(
        { error: 'Reference is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify with Paystack
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        }
      }
    );

    const data = await response.json();

    if (!data.status || data.data.status !== 'success') {
      // Update payment as failed
      await supabase
        .from('payment_history')
        .update({ status: 'failed' })
        .eq('paystack_reference', reference);

      return NextResponse.json(
        { error: 'Payment verification failed' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Payment successful - update user subscription
    const metadata = data.data.metadata;
    const userId = metadata.userId;
    const interval = metadata.interval;

    const now = new Date();
    const endDate = new Date(now);
    if (interval === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Update payment history
    await supabase
      .from('payment_history')
      .update({
        status: 'success',
        paystack_transaction_id: data.data.id
      })
      .eq('paystack_reference', reference);

    // Update user profile
    await supabase
      .from('profiles')
      .update({
        subscription_tier: 'pro',
        subscription_status: 'active',
        subscription_start_date: now.toISOString(),
        subscription_end_date: endDate.toISOString(),
        paystack_customer_code: data.data.customer.customer_code,
        updated_at: now.toISOString()
      })
      .eq('id', userId);

    return NextResponse.json({
      success: true,
      message: 'Pro subscription activated successfully'
    }, {
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to verify payment' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  });
}