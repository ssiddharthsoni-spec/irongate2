'use client';

import { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface ComplianceProfile {
  id: string;
  name: string;
  shortName: string;
  description: string;
  version: string;
  riskMultiplier: number;
  autoBlockThreshold: number;
  entityRuleCount: number;
  requiredControlCount: number;
  reportingFrequency: string;
}

interface EntityRule {
  entityType: string;
  action: string;
  riskMultiplier: number;
  justification: string;
}

interface ActiveConfig {
  frameworks: string[];
  mergedEntityRules: EntityRule[];
  effectiveRiskMultiplier: number;
  effectiveBlockThreshold: number;
  allRequiredControls: string[];
  retentionPolicy: {
    auditLogDays: number;
    eventDataDays: number;
    pseudonymMapDays: number;
    deleteRawPrompts: boolean;
  } | null;
}

interface ComplianceStatusItem {
  frameworkId: string;
  name: string;
  shortName: string;
  enabled: boolean;
  score: number;
  controlsMet: number;
  controlsTotal: number;
  lastAssessmentDate: string | null;
}

// Demo profiles (fallback when API is unavailable)
const DEMO_PROFILES: ComplianceProfile[] = [
  { id: 'soc2', name: 'SOC 2 Type II', shortName: 'SOC 2', description: 'Trust Services Criteria for security, availability, processing integrity, confidentiality, and privacy.', version: '2024', riskMultiplier: 1.3, autoBlockThreshold: 85, entityRuleCount: 9, requiredControlCount: 6, reportingFrequency: 'quarterly' },
  { id: 'hipaa', name: 'HIPAA', shortName: 'HIPAA', description: 'Protects individually identifiable health information (PHI).', version: '2024', riskMultiplier: 2.0, autoBlockThreshold: 60, entityRuleCount: 10, requiredControlCount: 8, reportingFrequency: 'monthly' },
  { id: 'gdpr', name: 'GDPR', shortName: 'GDPR', description: 'EU regulation for personal data protection and privacy rights.', version: '2024', riskMultiplier: 1.5, autoBlockThreshold: 70, entityRuleCount: 10, requiredControlCount: 8, reportingFrequency: 'monthly' },
  { id: 'pci_dss', name: 'PCI DSS v4.0', shortName: 'PCI DSS', description: 'Protects cardholder data and sensitive authentication data.', version: '4.0', riskMultiplier: 2.5, autoBlockThreshold: 50, entityRuleCount: 6, requiredControlCount: 8, reportingFrequency: 'quarterly' },
  { id: 'ccpa', name: 'CCPA / CPRA', shortName: 'CCPA', description: 'California consumer data privacy rights and business obligations.', version: '2024', riskMultiplier: 1.2, autoBlockThreshold: 75, entityRuleCount: 9, requiredControlCount: 6, reportingFrequency: 'quarterly' },
  { id: 'glba', name: 'GLBA', shortName: 'GLBA', description: 'Protects consumers\' nonpublic personal financial information.', version: '2024', riskMultiplier: 1.8, autoBlockThreshold: 65, entityRuleCount: 7, requiredControlCount: 6, reportingFrequency: 'quarterly' },
  { id: 'ferpa', name: 'FERPA', shortName: 'FERPA', description: 'Protects student education records.', version: '2024', riskMultiplier: 1.3, autoBlockThreshold: 70, entityRuleCount: 5, requiredControlCount: 5, reportingFrequency: 'monthly' },
];

const ACTION_COLORS: Record<string, string> = {
  block: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  redact: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  pseudonymize: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  flag: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  allow: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function CompliancePage() {
  const { apiFetch } = useApiClient();
  const [profiles, setProfiles] = useState<ComplianceProfile[]>(DEMO_PROFILES);
  const [activeFrameworks, setActiveFrameworks] = useState<string[]>(['soc2', 'gdpr']);
  const [activeConfig, setActiveConfig] = useState<ActiveConfig | null>(null);
  const [statuses, setStatuses] = useState<ComplianceStatusItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'overview' | 'rules' | 'controls' | 'retention'>('overview');

  // Fetch available profiles
  useEffect(() => {
    apiFetch('/compliance/profiles')
      .then(r => r.json())
      .then(data => {
        if (data.profiles) setProfiles(data.profiles);
      })
      .catch(() => {});
  }, []);

  // Fetch active configuration
  useEffect(() => {
    apiFetch('/compliance/active')
      .then(r => r.json())
      .then(data => {
        if (data.frameworks) {
          setActiveFrameworks(data.frameworks);
          setActiveConfig(data);
        }
      })
      .catch(() => {
        // Use demo active config
        setActiveConfig({
          frameworks: activeFrameworks,
          mergedEntityRules: [
            { entityType: 'SSN', action: 'redact', riskMultiplier: 2.5, justification: 'GDPR Art. 9 / SOC 2 CC6.1' },
            { entityType: 'CREDIT_CARD', action: 'redact', riskMultiplier: 2.0, justification: 'SOC 2 CC6.1 / GDPR Art. 4(1)' },
            { entityType: 'API_KEY', action: 'block', riskMultiplier: 3.0, justification: 'SOC 2 CC6.6' },
            { entityType: 'DATABASE_URI', action: 'block', riskMultiplier: 3.0, justification: 'SOC 2 CC6.6' },
            { entityType: 'PRIVATE_KEY', action: 'block', riskMultiplier: 3.0, justification: 'SOC 2 CC6.1' },
            { entityType: 'PERSON', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'GDPR Art. 4(5)' },
            { entityType: 'EMAIL', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'GDPR Art. 4(1)' },
            { entityType: 'PHONE_NUMBER', action: 'pseudonymize', riskMultiplier: 1.5, justification: 'GDPR Art. 4(1)' },
            { entityType: 'MEDICAL_RECORD', action: 'redact', riskMultiplier: 2.5, justification: 'GDPR Art. 9(1)' },
            { entityType: 'IP_ADDRESS', action: 'pseudonymize', riskMultiplier: 1.3, justification: 'GDPR Recital 30' },
            { entityType: 'PASSPORT_NUMBER', action: 'redact', riskMultiplier: 2.0, justification: 'GDPR Art. 87' },
          ],
          effectiveRiskMultiplier: 1.5,
          effectiveBlockThreshold: 70,
          allRequiredControls: [
            'Cryptographic audit trail',
            'Encryption at rest for stored data',
            'Data Protection Impact Assessment (DPIA)',
            'Data subject rights procedures',
            'Data breach notification within 72 hours',
            'Records of processing activities',
            'Annual penetration testing',
            'Employee security awareness training',
          ],
          retentionPolicy: {
            auditLogDays: 1095,
            eventDataDays: 730,
            pseudonymMapDays: 365,
            deleteRawPrompts: true,
          },
        });
      });
  }, []);

  // Fetch compliance status
  useEffect(() => {
    apiFetch('/compliance/status')
      .then(r => r.json())
      .then(data => {
        if (data.frameworks) setStatuses(data.frameworks);
      })
      .catch(() => {
        setStatuses(activeFrameworks.map(id => {
          const p = profiles.find(p => p.id === id);
          return {
            frameworkId: id,
            name: p?.name || id,
            shortName: p?.shortName || id,
            enabled: true,
            score: 87,
            controlsMet: Math.round((p?.requiredControlCount || 6) * 0.87),
            controlsTotal: p?.requiredControlCount || 6,
            lastAssessmentDate: new Date().toISOString(),
          };
        }));
      });
  }, [activeFrameworks]);

  const toggleFramework = (id: string) => {
    setActiveFrameworks(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const saveConfiguration = async () => {
    setSaving(true);
    try {
      await apiFetch('/compliance/active', {
        method: 'PUT',
        body: JSON.stringify({ frameworks: activeFrameworks }),
      });
    } catch {
      // OK in demo mode
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Compliance</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Configure regulatory frameworks and entity handling policies
          </p>
        </div>
        <button
          onClick={saveConfiguration}
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* Status Cards */}
      {statuses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statuses.map(status => (
            <div key={status.frameworkId} className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{status.shortName}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  status.score >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  status.score >= 60 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {status.score}%
                </span>
              </div>
              <div className="w-full bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    status.score >= 80 ? 'bg-green-500' : status.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${status.score}%` }}
                />
              </div>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-2">
                {status.controlsMet}/{status.controlsTotal} controls met
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Framework Selection */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 p-6">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Active Frameworks</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
          Select the compliance frameworks applicable to your organization. When multiple frameworks overlap, the strictest rules apply.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {profiles.map(profile => {
            const isActive = activeFrameworks.includes(profile.id);
            return (
              <button
                key={profile.id}
                onClick={() => toggleFramework(profile.id)}
                className={`text-left p-4 rounded-lg border-2 transition-all ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-[#d2d2d7] dark:hover:border-[#38383a]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{profile.name}</span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isActive ? 'border-indigo-500 bg-indigo-500' : 'border-[#d2d2d7] dark:border-[#38383a]'
                  }`}>
                    {isActive && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[#6e6e73] dark:text-[#86868b] line-clamp-2">{profile.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-[#86868b]">
                  <span>{profile.entityRuleCount} rules</span>
                  <span>{profile.requiredControlCount} controls</span>
                  <span>{profile.riskMultiplier}x risk</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Effective Configuration Tabs */}
      {activeConfig && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
          {/* Tab Bar */}
          <div className="border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 px-6">
            <div className="flex gap-6">
              {(['overview', 'rules', 'controls', 'retention'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                    tab === t
                      ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-[#6e6e73] hover:text-[#424245] dark:text-[#86868b] dark:hover:text-[#d2d2d7]'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {tab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                  <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Effective Risk Multiplier</p>
                  <p className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">{activeConfig.effectiveRiskMultiplier}x</p>
                  <p className="text-xs text-[#86868b] mt-1">Applied to sensitivity scores</p>
                </div>
                <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                  <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Auto-Block Threshold</p>
                  <p className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">{activeConfig.effectiveBlockThreshold}</p>
                  <p className="text-xs text-[#86868b] mt-1">Score above this is auto-blocked</p>
                </div>
                <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                  <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Entity Rules</p>
                  <p className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">{activeConfig.mergedEntityRules.length}</p>
                  <p className="text-xs text-[#86868b] mt-1">Merged from {activeConfig.frameworks.length} framework{activeConfig.frameworks.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            )}

            {/* Entity Rules Tab */}
            {tab === 'rules' && (
              <div className="space-y-2">
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
                  When multiple frameworks define rules for the same entity type, the strictest action applies.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[#6e6e73] dark:text-[#86868b] border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60">
                        <th className="pb-2 font-medium">Entity Type</th>
                        <th className="pb-2 font-medium">Action</th>
                        <th className="pb-2 font-medium">Risk Multiplier</th>
                        <th className="pb-2 font-medium">Justification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeConfig.mergedEntityRules.map((rule, i) => (
                        <tr key={i} className="border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60/50">
                          <td className="py-2.5 font-mono text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">{rule.entityType}</td>
                          <td className="py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[rule.action] || 'bg-[#f5f5f7] text-[#424245]'}`}>
                              {rule.action}
                            </span>
                          </td>
                          <td className="py-2.5 text-[#6e6e73] dark:text-[#86868b]">{rule.riskMultiplier}x</td>
                          <td className="py-2.5 text-xs text-[#6e6e73] dark:text-[#86868b]">{rule.justification}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Required Controls Tab */}
            {tab === 'controls' && (
              <div className="space-y-2">
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
                  These controls are required across all active compliance frameworks.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeConfig.allRequiredControls.map((ctrl, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                      <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                      <span className="text-sm text-[#424245] dark:text-[#a1a1a6]">{ctrl}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Retention Policy Tab */}
            {tab === 'retention' && activeConfig.retentionPolicy && (
              <div className="space-y-4">
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-4">
                  Retention periods are set to the longest required by any active framework.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Audit Logs</p>
                    <p className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                      {Math.round(activeConfig.retentionPolicy.auditLogDays / 365)} years
                    </p>
                    <p className="text-xs text-[#86868b]">{activeConfig.retentionPolicy.auditLogDays} days</p>
                  </div>
                  <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Event Data</p>
                    <p className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                      {Math.round(activeConfig.retentionPolicy.eventDataDays / 365)} years
                    </p>
                    <p className="text-xs text-[#86868b]">{activeConfig.retentionPolicy.eventDataDays} days</p>
                  </div>
                  <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Pseudonym Maps</p>
                    <p className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                      {Math.round(activeConfig.retentionPolicy.pseudonymMapDays / 30)} months
                    </p>
                    <p className="text-xs text-[#86868b]">{activeConfig.retentionPolicy.pseudonymMapDays} days</p>
                  </div>
                  <div className="p-4 bg-[#f5f5f7] dark:bg-[#141414] rounded-lg">
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">Raw Prompts</p>
                    <p className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                      {activeConfig.retentionPolicy.deleteRawPrompts ? 'Deleted' : 'Retained'}
                    </p>
                    <p className="text-xs text-[#86868b]">
                      {activeConfig.retentionPolicy.deleteRawPrompts ? 'Never stored in plaintext' : 'Stored encrypted'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
