'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../../lib/api';

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
  highlighted?: boolean;
}

interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: 'paid' | 'pending' | 'failed';
  description: string;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/month',
    features: ['Up to 500 prompts/month', '3 team members', 'Basic entity detection', 'Email alerts', '30-day data retention'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$49',
    period: '/month',
    features: ['Up to 5,000 prompts/month', '10 team members', 'Advanced entity detection', 'Slack + email alerts', '90-day data retention', 'API access'],
    highlighted: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: '$199',
    period: '/month',
    features: ['Up to 50,000 prompts/month', 'Unlimited team members', 'All entity types', 'Custom webhooks', '180-day data retention', 'Priority support', 'Executive Lens'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    features: ['Unlimited prompts', 'Unlimited team members', 'Custom model training', 'Dedicated support', 'Custom data retention', 'SSO & SCIM', 'On-premise option', 'SLA guarantee'],
  },
];

const DEMO_INVOICES: Invoice[] = [
  { id: 'inv_001', date: '2026-02-01', amount: '$49.00', status: 'paid', description: 'Pro Plan - February 2026' },
  { id: 'inv_002', date: '2026-01-01', amount: '$49.00', status: 'paid', description: 'Pro Plan - January 2026' },
  { id: 'inv_003', date: '2025-12-01', amount: '$49.00', status: 'paid', description: 'Pro Plan - December 2025' },
  { id: 'inv_004', date: '2025-11-01', amount: '$49.00', status: 'paid', description: 'Pro Plan - November 2025' },
];

const DEMO_USAGE = {
  plan: 'pro',
  promptsUsed: 2847,
  promptsLimit: 5000,
  entitiesDetected: 14283,
  usersCount: 6,
  usersLimit: 10,
};

export default function BillingPage() {
  const { apiFetch } = useApiClient();

  const [currentPlan, setCurrentPlan] = useState('pro');
  const [usage, setUsage] = useState(DEMO_USAGE);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [managingBilling, setManagingBilling] = useState(false);

  useEffect(() => {
    async function fetchBilling() {
      try {
        setLoading(true);
        const response = await apiFetch('/billing');
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.plan) setCurrentPlan(data.plan);
        if (data.usage) setUsage(data.usage);
        if (data.invoices) setInvoices(data.invoices);
      } catch {
        setCurrentPlan(DEMO_USAGE.plan);
        setUsage(DEMO_USAGE);
        setInvoices(DEMO_INVOICES);
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
        body: JSON.stringify({ planId }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // In demo mode, simulate upgrade
      setCurrentPlan(planId);
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
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // Demo mode - no-op
    } finally {
      setManagingBilling(false);
    }
  }

  function getUsagePercentage(used: number, limit: number) {
    return Math.min((used / limit) * 100, 100);
  }

  function getUsageColor(percentage: number) {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-iron-500';
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const currentPlanObj = PLANS.find((p) => p.id === currentPlan);
  const promptPct = getUsagePercentage(usage.promptsUsed, usage.promptsLimit);
  const userPct = getUsagePercentage(usage.usersCount, usage.usersLimit);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Current Plan & Usage */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Current Plan</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex px-3 py-1 rounded-full text-sm font-semibold bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300">
                {currentPlanObj?.name || 'Free'}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {currentPlanObj?.price}{currentPlanObj?.period}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManageBilling}
            disabled={managingBilling}
            className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500"
          >
            {managingBilling ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                Loading...
              </span>
            ) : (
              'Manage Billing'
            )}
          </button>
        </div>

        {/* Usage Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Prompts This Month</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {usage.promptsUsed.toLocaleString()}
              <span className="text-sm font-normal text-gray-400 dark:text-gray-500"> / {usage.promptsLimit.toLocaleString()}</span>
            </p>
            <div className="mt-2 w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getUsageColor(promptPct)}`}
                style={{ width: `${promptPct}%` }}
              />
            </div>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Entities Detected</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {usage.entitiesDetected.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Lifetime total</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Team Members</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {usage.usersCount}
              <span className="text-sm font-normal text-gray-400 dark:text-gray-500"> / {usage.usersLimit}</span>
            </p>
            <div className="mt-2 w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getUsageColor(userPct)}`}
                style={{ width: `${userPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Plan Comparison */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                className={`bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border-2 transition-colors ${
                  plan.highlighted
                    ? 'border-iron-500 dark:border-iron-400'
                    : isCurrent
                    ? 'border-iron-200 dark:border-iron-800'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                {plan.highlighted && (
                  <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 mb-3">
                    Most Popular
                  </span>
                )}
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                <div className="mt-1 mb-4">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{plan.price}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{plan.period}</span>
                </div>
                <ul className="space-y-2 mb-5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <svg className="w-4 h-4 text-iron-500 dark:text-iron-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div className="min-h-[44px] w-full px-4 py-2.5 rounded-lg text-sm font-medium text-center bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    Current Plan
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={upgrading === plan.id}
                    className={`min-h-[44px] w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                      plan.highlighted
                        ? 'bg-iron-600 hover:bg-iron-700 text-white'
                        : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    } ${upgrading === plan.id ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {upgrading === plan.id ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : plan.id === 'enterprise' ? (
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

      {/* Recent Invoices */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Invoices</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Amount</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">No invoices yet.</p>
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap" suppressHydrationWarning>
                      {new Date(invoice.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-900 dark:text-white">{invoice.description}</td>
                    <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-white tabular-nums">{invoice.amount}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(invoice.status)}`}>
                        {invoice.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
