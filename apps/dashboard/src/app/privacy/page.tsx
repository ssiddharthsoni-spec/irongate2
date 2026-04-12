import Link from 'next/link';

function ShieldCheckIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-[#1d1d1f] dark:text-[#f5f5f7]">

      {/* ════════════════ NAV ════════════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-lg border-b border-[#d2d2d7]/30 dark:border-[#38383a]/40/50">
        <div className="flex items-center justify-between px-6 md:px-12 py-3 max-w-7xl mx-auto">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-iron-600 rounded-lg flex items-center justify-center shadow-lg shadow-iron-600/20">
              <ShieldCheckIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Iron Gate</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
              Home
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
              Sign In
            </Link>
            <Link href="/sign-up" className="px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-semibold rounded-lg transition-all shadow-md shadow-iron-600/20 hover:shadow-lg hover:shadow-iron-600/30">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ════════════════ CONTENT ════════════════ */}
      <div className="pt-28 pb-20 px-6 md:px-12">
        <div className="max-w-4xl mx-auto">

          {/* Back link */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-iron-600 dark:hover:text-iron-400 transition-colors mb-8"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Home
          </Link>

          {/* Title */}
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-sm text-[#86868b] dark:text-[#636366] mb-12">Last Updated: April 2026</p>


          {/* ── 1. What Iron Gate Does ───────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">What Iron Gate Does</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
              Iron Gate is a Chrome extension and enterprise platform that detects and protects
              sensitive data before it reaches AI tools such as ChatGPT, Claude, Gemini, Copilot,
              Perplexity, DeepSeek, Poe, Groq, HuggingFace Chat, and You.com. The extension
              intercepts prompts in the browser, identifies sensitive entities (names, SSNs, credit
              card numbers, medical records, etc.), and either warns the user or replaces sensitive
              values with realistic pseudonyms so employees can use AI productively without
              exposing real data.
            </p>
          </section>


          {/* ── 2. Data Collection ───────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Data Collection</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-6">
              Iron Gate follows a <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">zero-persistence architecture</strong>.
              This means:
            </p>

            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
                  <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Raw prompts are never stored, logged, or transmitted to Iron Gate servers.</strong>{' '}
                  All entity detection runs locally in the browser within the Chrome extension.
                </p>
              </div>

              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
                  Only <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">anonymized event metadata</strong> is sent
                  to the dashboard API. This includes: the types of entities detected (e.g. &ldquo;PERSON&rdquo;,
                  &ldquo;SSN&rdquo;), the sensitivity score, the AI tool used, and a timestamp. No raw text,
                  names, or PII values are included.
                </p>
              </div>

              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
                  There is no database column for raw prompt text. This is a structural guarantee,
                  not a policy decision &mdash; the data physically cannot be stored because the
                  schema does not accommodate it.
                </p>
              </div>
            </div>
          </section>


          {/* ── 3. Chrome Extension Permissions ──────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Chrome Extension Permissions</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-6">
              The Iron Gate extension requests the following Chrome permissions. Each is required
              for a specific function:
            </p>

            <div className="space-y-4">
              {[
                {
                  permission: 'storage',
                  reason: 'Stores user preferences, detection settings, and the pseudonym reverse map locally in the browser. No data leaves the device via this permission.',
                },
                {
                  permission: 'sidePanel',
                  reason: 'Displays the Iron Gate side panel UI where users can review detected entities, adjust settings, and see sensitivity scores for their prompts.',
                },
                {
                  permission: 'activeTab',
                  reason: 'Allows the extension to read the current tab\'s URL to determine which AI tool the user is interacting with and apply the correct adapter.',
                },
                {
                  permission: 'scripting',
                  reason: 'Injects the content script into supported AI tool pages to intercept prompts before they are sent to the AI provider.',
                },
                {
                  permission: 'declarativeNetRequest',
                  reason: 'Modifies HTTP request and response headers at the network level to enable pseudonymization of outbound prompts and de-pseudonymization of inbound AI responses.',
                },
                {
                  permission: 'Host permissions (9 AI tool domains)',
                  reason: 'Required to run content scripts on ChatGPT (chat.openai.com), Claude (claude.ai), Gemini (gemini.google.com), GitHub Copilot, Perplexity, DeepSeek, Poe, Groq, HuggingFace Chat, and You.com. The extension only activates on these specific domains.',
                },
              ].map((item) => (
                <div
                  key={item.permission}
                  className="bg-[#f5f5f7] dark:bg-[#141414] rounded-xl p-5 border border-[#d2d2d7]/30 dark:border-[#38383a]/40"
                >
                  <p className="font-semibold text-[#1d1d1f] dark:text-[#d2d2d7] mb-1">
                    <code className="px-1.5 py-0.5 bg-white dark:bg-[#2c2c2e] rounded text-sm font-mono text-iron-600 dark:text-iron-400">
                      {item.permission}
                    </code>
                  </p>
                  <p className="text-[#6e6e73] dark:text-[#86868b] text-sm leading-relaxed mt-2">
                    {item.reason}
                  </p>
                </div>
              ))}
            </div>
          </section>


          {/* ── 4. Enterprise Managed Mode ───────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Enterprise Managed Mode</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
              When deployed by an IT administrator, the Iron Gate extension reads configuration
              from <code className="px-1.5 py-0.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded text-xs font-mono text-iron-600 dark:text-iron-400">chrome.storage.managed</code>,
              which is set via enterprise policy (e.g. Google Admin Console or Windows Group Policy).
              This allows centralized control of detection thresholds, allowed AI tools, and
              enforcement mode. No additional data is collected in managed mode beyond the same
              anonymized event metadata described above.
            </p>
          </section>


          {/* ── 5. Data Retention ────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Data Retention</h2>

            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <div>
                  <p className="font-semibold text-[#1d1d1f] dark:text-[#d2d2d7]">Event Metadata</p>
                  <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
                    Anonymized event metadata is retained for the customer&rsquo;s configured
                    retention period (default: 90 days), after which it is automatically and
                    permanently deleted.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <div>
                  <p className="font-semibold text-[#1d1d1f] dark:text-[#d2d2d7]">Pseudonym Maps</p>
                  <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
                    Pseudonym mappings are held in browser memory only and expire after 24 hours.
                    They are never transmitted to Iron Gate servers.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <div>
                  <p className="font-semibold text-[#1d1d1f] dark:text-[#d2d2d7]">Data Deletion</p>
                  <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
                    Customers can request complete deletion of their organization&rsquo;s data at
                    any time. Upon receiving a valid deletion request, all related records are
                    permanently removed within 30 days.
                  </p>
                </div>
              </div>
            </div>
          </section>


          {/* ── 6. Third Parties ─────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Third Parties</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-6">
              <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Iron Gate does not sell, share, or provide user data to third parties.</strong>
            </p>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-6">
              We use the following services to operate the platform:
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  name: 'Clerk',
                  url: 'clerk.com',
                  purpose: 'Dashboard authentication and user management',
                },
                {
                  name: 'Supabase',
                  url: 'supabase.com',
                  purpose: 'Database hosting (anonymized metadata only)',
                },
                {
                  name: 'Render',
                  url: 'render.com',
                  purpose: 'API server hosting',
                },
                {
                  name: 'Vercel',
                  url: 'vercel.com',
                  purpose: 'Dashboard web hosting',
                },
              ].map((service) => (
                <div
                  key={service.name}
                  className="bg-[#f5f5f7] dark:bg-[#141414] rounded-xl p-4 border border-[#d2d2d7]/30 dark:border-[#38383a]/40"
                >
                  <p className="font-semibold text-[#1d1d1f] dark:text-[#d2d2d7]">{service.name}</p>
                  <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">{service.purpose}</p>
                </div>
              ))}
            </div>
          </section>


          {/* ── 7. Security ──────────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Security</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-6">
              Security is foundational to Iron Gate. We implement multiple layers of protection:
            </p>

            <ul className="space-y-3">
              {[
                {
                  title: 'Zero-Persistence Architecture',
                  desc: 'Raw prompt text is never stored, logged, or transmitted. There is no database column for it. This eliminates the most significant attack surface by design.',
                },
                {
                  title: 'Per-Firm Tenant Isolation',
                  desc: 'PostgreSQL Row-Level Security (RLS) policies enforce strict data isolation at the database layer. No organization can access another organization\'s data.',
                },
                {
                  title: 'Encryption',
                  desc: 'All data at rest is encrypted using AES-256-GCM with per-firm encryption keys. Data in transit is encrypted via TLS 1.2+.',
                },
                {
                  title: 'Cryptographic Audit Trail',
                  desc: 'Every event is hash-chained using SHA-256. If any record is tampered with, the hash chain breaks, providing immediate tamper detection.',
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-3 items-start">
                  <svg className="w-5 h-5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-[#1d1d1f] dark:text-[#d2d2d7]">{item.title}</p>
                    <p className="text-sm text-[#6e6e73] dark:text-[#86868b] leading-relaxed">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>


          {/* ── 8. Contact ───────────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Contact</h2>
            <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
              If you have any questions about this Privacy Policy, your data, or your rights,
              please contact us at{' '}
              <a
                href="mailto:privacy@irongate.ai"
                className="text-iron-600 dark:text-iron-400 hover:text-iron-700 dark:hover:text-iron-300 underline underline-offset-2 transition-colors"
              >
                privacy@irongate.ai
              </a>
              .
            </p>
          </section>

        </div>
      </div>

      {/* ════════════════ FOOTER ════════════════ */}
      <footer className="border-t border-[#d2d2d7]/30 dark:border-[#38383a]/40/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
                <ShieldCheckIcon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold">Iron Gate</p>
                <p className="text-xs text-[#86868b] dark:text-[#636366]">Enterprise AI Governance Platform</p>
              </div>
            </div>

            <div className="flex items-center gap-8 text-sm text-[#86868b] dark:text-[#636366]">
              <Link href="/" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Home</Link>
              <Link href="/demo" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Demo</Link>
              <Link href="/privacy" className="text-[#6e6e73] dark:text-[#a1a1a6] font-medium">Privacy</Link>
            </div>

            <p className="text-xs text-[#86868b] dark:text-[#636366]">v0.2.7</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
