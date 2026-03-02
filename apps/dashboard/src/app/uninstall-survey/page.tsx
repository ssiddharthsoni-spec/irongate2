'use client';

import React, { useState } from 'react';

const REASONS = [
  'It slowed down my browser',
  'It blocked too many prompts',
  'I don\'t use AI tools anymore',
  'I found a better alternative',
  'It was too complicated to set up',
  'My firm switched to a different tool',
  'Privacy concerns',
  'Other',
];

export default function UninstallSurveyPage() {
  const [selectedReason, setSelectedReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedReason) return;

    setSubmitting(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://irongate-api.onrender.com/v1';
      await fetch(`${apiUrl}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'uninstall',
          reason: selectedReason,
          details: details || undefined,
        }),
      }).catch(() => {});
    } finally {
      setSubmitted(true);
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] dark:bg-[#0a0a0a]">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="w-16 h-16 bg-iron-100 dark:bg-iron-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Thank you for your feedback</h1>
          <p className="text-[#6e6e73] dark:text-[#86868b]">
            We appreciate you taking the time to help us improve Iron Gate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] dark:bg-[#0a0a0a]">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-iron-600 rounded-xl flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-sm font-bold">IG</span>
            </div>
            <h1 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">We're sorry to see you go</h1>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
              Help us improve by sharing why you uninstalled Iron Gate.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset className="space-y-2">
              {REASONS.map((reason) => (
                <label
                  key={reason}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedReason === reason
                      ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20 dark:border-iron-400'
                      : 'border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                  }`}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={reason}
                    checked={selectedReason === reason}
                    onChange={(e) => setSelectedReason(e.target.value)}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    selectedReason === reason
                      ? 'border-iron-500 dark:border-iron-400'
                      : 'border-[#d2d2d7] dark:border-[#48484a]'
                  }`}>
                    {selectedReason === reason && (
                      <div className="w-2 h-2 rounded-full bg-iron-500 dark:bg-iron-400" />
                    )}
                  </div>
                  <span className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{reason}</span>
                </label>
              ))}
            </fieldset>

            <textarea
              placeholder="Any additional feedback? (optional)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-white dark:bg-[#2c2c2e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#aeaeb2] dark:placeholder-[#636366] focus:outline-none focus:ring-2 focus:ring-iron-500 resize-none"
            />

            <button
              type="submit"
              disabled={!selectedReason || submitting}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium bg-iron-600 hover:bg-iron-700 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
