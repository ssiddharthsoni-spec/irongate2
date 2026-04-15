'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../../lib/api';
import { useToast } from '@/components/toast';

interface Plan {
  id: string;
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  period: string;
  features: string[];
  highlighted?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Basic',
    monthlyPrice: '$0',
    annualPrice: '$0',
    period: '',
    features: ['All AI platforms supported', 'Audit mode (monitor only)', 'Regex-based detection', 'Unlimited scans', 'Community support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: '$18',
    annualPrice: '$15',
    period: '/user/month',
    features: ['Everything in Basic', 'ML-powered detection', 'Proxy mode (auto-redact)', 'Compliance export', 'Email support', '15-day free trial'],
    highlighted: true,
  },
  {
    id: 'business',
    name: 'Team',
    monthlyPrice: '$99',
    annualPrice: '$79',
    period: '/month (flat)',
    features: ['Everything in Pro', 'Up to 10 users included', 'Shared admin dashboard', 'Slack + email alerts', 'Priority support', '1-year data retention'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: '',
    annualPrice: '',
    period: '',
    features: ['Everything in Team', 'Unlimited users', 'SSO & SCIM provisioning', 'Custom entity types', 'SIEM integration', 'On-premise deployment', 'SLA guarantee', 'Dedicated support engineer'],
  },
];

export default function BillingPage() {
  const { apiFetch } = useApiClient();
  const { addToast } = useToast();

  const [currentPlan, setCurrentPlan] = useState('free');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>('active');
  const [trialEnd, setTrialEnd] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [managingBilling, setManagingBilling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBilling() {
      try {
        setLoading(true);
        const response = await apiFetch('/billing');
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.subscription) {
          setCurrentPlan(data.subscription.tier || 'free');
          setSubscriptionStatus(data.subscription.status || 'active');
          setTrialEnd(data.subscription.currentPeriodEnd || null);
        } else if (data.plan) {
          setCurrentPlan(data.plan);
        }
      } catch {
        setCurrentPlan('free');
        setSubscriptionStatus('active');
      } finally {
        setLoading(false);
      }
    }
    fetchBilling();
  }, []);

  async function handleUpgrade(planId: string) {
    if (planId === 'enterprise') {
      window.open('mailto:sales@irongate.ai?subject=Enterprise%20Plan%20Inquiry', '_blank');
      return;
    }
    try {
      setUpgrading(planId);
      const response = await apiFetch('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier: planId, cycle: billingCycle }),
      });

      // 503 billing_not_configured → show a clear actionable message instead
      // of dropping the user on a fake Stripe URL (which then bottomed out on
      // an S3 AccessDenied XML page — see API billing.ts for the matching fix).
      if (response.status === 503) {
        const body = await response.json().catch(() => ({}));
        const msg = body?.message || 'Billing is not yet available on this server. Contact hello@irongate.ai to activate your subscription.';
        setErrorMessage(msg);
        addToast({ type: 'error', message: msg });
        setTimeout(() => setErrorMessage(null), 10_000);
        return;
      }

      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      const checkoutUrl = data.url || data.checkoutUrl;
      if (!checkoutUrl) {
        addToast({ type: 'error', message: 'Failed to initialize checkout. Please try again.' });
        return;
      }
      // Sanity-check: reject any URL that clearly isn't a real Stripe session.
      // Prevents a partial-config regression from redirecting users to broken
      // pages (the "mock-session" URL was landing on an AWS S3 AccessDenied).
      if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(checkoutUrl) ||
          /mock-session|mock-portal/.test(checkoutUrl)) {
        const msg = 'Checkout URL returned by the server is invalid. Billing may not be configured yet — contact hello@irongate.ai.';
        setErrorMessage(msg);
        addToast({ type: 'error', message: msg });
        setTimeout(() => setErrorMessage(null), 10_000);
        return;
      }
      window.location.href = checkoutUrl;
    } catch (err) {
      setErrorMessage('Failed to start checkout. Please try again.');
      addToast({ type: 'error', message: 'Failed to start checkout. Please try again.' });
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setUpgrading(null);
    }
  }

  async function handleManageBilling() {
    try {
      setManagingBilling(true);
      const response = await apiFetch('/billing/portal', {
        method: 'POST',
      });

      if (response.status === 503) {
        const body = await response.json().catch(() => ({}));
        const msg = body?.message || 'Billing portal is not yet available. Contact hello@irongate.ai.';
        setErrorMessage(msg);
        addToast({ type: 'error', message: msg });
        setTimeout(() => setErrorMessage(null), 10_000);
        return;
      }

      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      const portalUrl = data.url || data.portalUrl;
      if (!portalUrl) {
        addToast({ type: 'error', message: 'Failed to open billing portal. Please try again.' });
        return;
      }
      // Same sanity-check as /checkout: no mock URLs.
      if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(portalUrl) ||
          /mock-session|mock-portal/.test(portalUrl)) {
        const msg = 'Portal URL returned by the server is invalid. Billing may not be configured yet.';
        setErrorMessage(msg);
        addToast({ type: 'error', message: msg });
        setTimeout(() => setErrorMessage(null), 10_000);
        return;
      }
      window.location.href = portalUrl;
    } catch {
      setErrorMessage('Failed to open billing portal. Please try again.');
      addToast({ type: 'error', message: 'Failed to open billing portal. Please try again.' });
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setManagingBilling(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="h-6 w-40 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse mb-4" />
          <div className="h-20 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-80 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const isTrialing = subscriptionStatus === 'trialing';
  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86400_000))
    : 0;
  const currentPlanObj = PLANS.find((p) => p.id === currentPlan);
  const renewalDate = trialEnd
    ? new Date(trialEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Current Plan + Next Invoice — side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Current Plan Card */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider mb-3">Current Plan</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {currentPlanObj?.name || 'Free'}
            </span>
            {isTrialing && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300">
                Trial
              </span>
            )}
          </div>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
            {currentPlan === 'free'
              ? 'Free forever'
              : currentPlan === 'enterprise'
                ? 'Custom pricing'
                : currentPlanObj?.monthlyPrice
                  ? `${billingCycle === 'annual' ? currentPlanObj.annualPrice : currentPlanObj.monthlyPrice}${currentPlanObj.period}`
                  : 'Free forever'}
          </p>
          <button
            type="button"
            onClick={handleManageBilling}
            disabled={managingBilling}
            className="w-full min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
          >
            {managingBilling ? 'Loading...' : 'Manage Billing'}
          </button>
        </div>

        {/* Next Invoice Card */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <p className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] uppercase tracking-wider mb-3">
            {isTrialing ? 'Trial Ends' : 'Next Invoice'}
          </p>
          {isTrialing ? (
            <>
              <p className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
                {trialDaysLeft > 0 ? `${trialDaysLeft} days left` : 'Trial ended'}
              </p>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
                {renewalDate ? `Ends on ${renewalDate}` : 'Add payment to continue'}
              </p>
              <button
                type="button"
                onClick={handleManageBilling}
                className="w-full min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium bg-iron-600 text-white hover:bg-iron-700 transition-colors"
              >
                Add Payment Method
              </button>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
                {currentPlanObj?.monthlyPrice
                  ? billingCycle === 'annual' ? currentPlanObj.annualPrice : currentPlanObj.monthlyPrice
                  : '$0'}
              </p>
              <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
                {renewalDate ? `Renewal on ${renewalDate}` : 'No upcoming invoice'}
              </p>
              <button
                type="button"
                onClick={handleManageBilling}
                className="w-full min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              >
                View Invoice
              </button>
            </>
          )}
        </div>
      </div>

      {/* Choose Plan */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Choose your plan</h2>
          <div className="flex items-center bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-white dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm'
                  : 'text-[#6e6e73] dark:text-[#86868b]'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                billingCycle === 'annual'
                  ? 'bg-white dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm'
                  : 'text-[#6e6e73] dark:text-[#86868b]'
              }`}
            >
              Annual
              <span className="ml-1 text-green-600 dark:text-green-400">Save 20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const isBasic = plan.id === 'free';
            const isEnterprise = plan.id === 'enterprise';
            const price = billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;

            return (
              <div
                key={plan.id}
                className={`bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border-2 transition-colors ${
                  isCurrent
                    ? 'border-iron-500 dark:border-iron-400'
                    : plan.highlighted
                      ? 'border-iron-200 dark:border-iron-800'
                      : 'border-[#d2d2d7]/40 dark:border-[#38383a]/60'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">{plan.name}</h3>
                  {isCurrent && (
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300">
                      Current
                    </span>
                  )}
                  {plan.highlighted && !isCurrent && (
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300">
                      Popular
                    </span>
                  )}
                </div>
                <div className="mb-5 min-h-[48px]">
                  {isEnterprise ? (
                    <span className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Custom</span>
                  ) : isBasic ? (
                    <span className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Free</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">{price}</span>
                      <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">{plan.period}</span>
                      {billingCycle === 'annual' && (
                        <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-medium">
                          billed annually
                        </span>
                      )}
                    </>
                  )}
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-[#6e6e73] dark:text-[#86868b]">
                      <svg className="w-4 h-4 text-iron-500 dark:text-iron-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div className="min-h-[40px] w-full px-4 py-2 rounded-lg text-sm font-medium text-center bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                    Current Plan
                  </div>
                ) : isBasic ? (
                  <div className="min-h-[40px] w-full px-4 py-2 rounded-lg text-sm font-medium text-center bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                    Free Forever
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={upgrading === plan.id}
                    className={`min-h-[40px] w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      plan.highlighted
                        ? 'bg-iron-600 hover:bg-iron-700 text-white'
                        : 'border border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                    } ${upgrading === plan.id ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {upgrading === plan.id ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : isEnterprise ? (
                      'Contact Sales'
                    ) : (
                      'Upgrade'
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
        </div>
      )}

      {/* Free plan note */}
      <div className="p-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
          <span className="font-medium text-[#424245] dark:text-[#a1a1a6]">Basic plan</span> — Free forever with unlimited scans, regex-based detection, and audit mode across all AI platforms. Pro trial included for 15 days.
        </p>
      </div>
    </div>
  );
}
