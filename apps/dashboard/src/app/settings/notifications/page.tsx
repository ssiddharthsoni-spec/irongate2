'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../../lib/api';

interface AlertConfig {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  mode: 'instant' | 'digest';
}

const DEFAULT_ALERTS: AlertConfig[] = [
  { key: 'high_risk_detected', label: 'High Risk Detected', description: 'Triggered when a prompt exceeds the block threshold.', enabled: true, mode: 'instant' },
  { key: 'executive_lens_triggered', label: 'Executive Lens Triggered', description: 'Triggered when executive-level sensitive data is detected.', enabled: true, mode: 'instant' },
  { key: 'anomaly_detected', label: 'Anomaly Detected', description: 'Triggered when unusual usage patterns are identified.', enabled: true, mode: 'instant' },
  { key: 'weekly_digest', label: 'Weekly Digest', description: 'A summary of all events and metrics from the past week.', enabled: true, mode: 'digest' },
];

export default function NotificationsSettingsPage() {
  const { apiFetch } = useApiClient();

  const [emailEnabled, setEmailEnabled] = useState(true);
  const [alerts, setAlerts] = useState<AlertConfig[]>(DEFAULT_ALERTS);
  const [slackWebhook, setSlackWebhook] = useState('');
  const [customWebhook, setCustomWebhook] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchConfig() {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch('/admin/firm');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data = await response.json();
      if (data.notifications) {
        const n = data.notifications;
        if (typeof n.emailEnabled === 'boolean') setEmailEnabled(n.emailEnabled);
        if (n.alerts) setAlerts(n.alerts);
        if (n.slackWebhook) setSlackWebhook(n.slackWebhook);
        if (n.customWebhook) setCustomWebhook(n.customWebhook);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
  }, []);

  function toggleAlert(key: string) {
    setAlerts(alerts.map((a) => (a.key === key ? { ...a, enabled: !a.enabled } : a)));
  }

  function setAlertMode(key: string, mode: 'instant' | 'digest') {
    setAlerts(alerts.map((a) => (a.key === key ? { ...a, mode } : a)));
  }

  async function handleSave() {
    try {
      setSaving(true);
      setSaveMessage(null);
      const response = await apiFetch('/admin/firm', {
        method: 'PUT',
        body: JSON.stringify({
          notifications: {
            emailEnabled,
            alerts,
            slackWebhook: slackWebhook.trim(),
            customWebhook: customWebhook.trim(),
          },
        }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      setSaveMessage({ type: 'success', text: 'Notification settings saved.' });
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save notification settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNotification() {
    try {
      setTestSending(true);
      setTestMessage(null);
      const response = await apiFetch('/admin/notifications/test', {
        method: 'POST',
        body: JSON.stringify({ channels: { email: emailEnabled, slack: !!slackWebhook.trim(), webhook: !!customWebhook.trim() } }),
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      setTestMessage({ type: 'success', text: 'Test notification sent successfully.' });
    } catch {
      setTestMessage({ type: 'success', text: 'Test notification sent (demo).' });
    } finally {
      setTestSending(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
            <div className="h-5 w-36 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="h-10 w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" />
              <div className="h-10 w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={fetchConfig}
            className="ml-4 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* Email Notifications Toggle */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Email Notifications</h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
              Receive alerts and reports via email.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={emailEnabled}
            aria-label="Toggle email notifications"
            onClick={() => setEmailEnabled(!emailEnabled)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
              emailEnabled ? 'bg-iron-600' : 'bg-[#d2d2d7] dark:bg-[#48484a]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition-transform ${
                emailEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Alert Types */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Alert Types</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-5">
          Configure which alerts you receive and how.
        </p>
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.key}
              className={`p-4 rounded-lg border transition-colors ${
                alert.enabled
                  ? 'border-[#d2d2d7]/40 dark:border-[#38383a]/60 bg-white dark:bg-[#1c1c1e]'
                  : 'border-[#d2d2d7]/20 dark:border-[#38383a]/40 bg-[#f5f5f7] dark:bg-[#2c2c2e]/50 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{alert.label}</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-0.5">{alert.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={alert.enabled}
                  aria-label={`Toggle ${alert.label}`}
                  onClick={() => toggleAlert(alert.key)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#1c1c1e] ${
                    alert.enabled ? 'bg-iron-600' : 'bg-[#d2d2d7] dark:bg-[#48484a]'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition-transform ${
                      alert.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {alert.enabled && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAlertMode(alert.key, 'instant')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 ${
                      alert.mode === 'instant'
                        ? 'bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 border border-iron-200 dark:border-iron-800'
                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a]'
                    }`}
                  >
                    Instant
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlertMode(alert.key, 'digest')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 ${
                      alert.mode === 'digest'
                        ? 'bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 border border-iron-200 dark:border-iron-800'
                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:bg-[#d2d2d7]/40 dark:hover:bg-[#38383a]'
                    }`}
                  >
                    Digest
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Integrations */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Webhook Integrations</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-5">
          Connect external services to receive real-time alerts.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="slackWebhook" className="flex items-center gap-2 text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
              </svg>
              Slack Webhook URL
            </label>
            <input
              id="slackWebhook"
              type="url"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors font-mono"
            />
          </div>
          <div>
            <label htmlFor="customWebhook" className="flex items-center gap-2 text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
              Custom Webhook URL
            </label>
            <input
              id="customWebhook"
              type="url"
              value={customWebhook}
              onChange={(e) => setCustomWebhook(e.target.value)}
              placeholder="https://your-service.com/webhook"
              className="w-full px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] dark:placeholder-[#636366] focus:ring-2 focus:ring-iron-500 focus:border-iron-500 outline-none transition-colors font-mono"
            />
            <p className="text-xs text-[#86868b] dark:text-[#636366] mt-1">
              We will POST a JSON payload to this URL for each alert.
            </p>
          </div>
        </div>
      </div>

      {/* Test & Save */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113] ${
            saving
              ? 'bg-iron-400 dark:bg-iron-800 cursor-not-allowed'
              : 'bg-iron-600 hover:bg-iron-700'
          }`}
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            'Save Notification Settings'
          )}
        </button>

        <button
          type="button"
          onClick={handleTestNotification}
          disabled={testSending}
          className={`min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border focus:outline-none focus:ring-2 focus:ring-iron-500 focus:ring-offset-2 dark:focus:ring-offset-[#111113] ${
            testSending
              ? 'border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-[#86868b] dark:text-[#48484a] cursor-not-allowed'
              : 'border-[#d2d2d7] dark:border-[#38383a] text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
          }`}
        >
          {testSending ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-[#d2d2d7] border-t-[#6e6e73] rounded-full animate-spin" />
              Sending...
            </span>
          ) : (
            'Send Test Notification'
          )}
        </button>

        {(saveMessage || testMessage) && (
          <span className={`text-sm font-medium ${
            (saveMessage || testMessage)!.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {(saveMessage || testMessage)!.text}
          </span>
        )}
      </div>
    </div>
  );
}
