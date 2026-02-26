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
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">

      {/* ════════════════ NAV ════════════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg border-b border-gray-100 dark:border-gray-800/50">
        <div className="flex items-center justify-between px-6 md:px-12 py-3 max-w-7xl mx-auto">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-iron-600 rounded-lg flex items-center justify-center shadow-lg shadow-iron-600/20">
              <ShieldCheckIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Iron Gate</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
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
            className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-iron-600 dark:hover:text-iron-400 transition-colors mb-8"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Home
          </Link>

          {/* Title */}
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-12">Last Updated: February 2026</p>


          {/* ── 1. Introduction ──────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Introduction</h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Iron Gate is an enterprise AI governance platform that helps organizations protect
              sensitive data when employees use AI tools such as ChatGPT, Claude, Gemini, and
              Copilot. We are committed to transparency about how we collect, process, and store
              data. This Privacy Policy explains what information we handle, how we handle it, and
              what rights you have regarding your data.
            </p>
          </section>


          {/* ── 2. Data We Collect ────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Data We Collect</h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Prompt Metadata</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  We collect sensitivity scores, entity type counts, AI tool identifiers, and
                  timestamps associated with prompts. <strong className="text-gray-900 dark:text-white">We do NOT store raw prompt text on our
                  servers.</strong>
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Document Metadata</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  For uploaded documents, we collect file names, file types, file sizes, sensitivity
                  scores, and entity counts. Original documents are not retained after processing.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Entity Detections</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  We record entity types (e.g. &ldquo;PERSON&rdquo;, &ldquo;SSN&rdquo;), character
                  positions, confidence scores, and detection source. Raw PII text is pseudonymized
                  before storage &mdash; we never store the original sensitive values.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Account Information</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  We collect your email address, display name, role, and firm association. Authentication
                  is managed through Clerk; we do not store passwords directly.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Billing Data</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  We store your subscription tier and payment history. All payment processing is
                  handled by Stripe. <strong className="text-gray-900 dark:text-white">We do not store credit card numbers.</strong>
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Usage Analytics</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  We collect page views and feature usage data via PostHog to improve the product
                  experience. This data is aggregated and does not include prompt content or
                  sensitive entity values.
                </p>
              </div>
            </div>
          </section>


          {/* ── 3. How We Process Data ───────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">How We Process Data</h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Browser-Side Detection</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  The Iron Gate Chrome extension detects sensitive entities in prompts before they
                  leave the browser using regex-based pattern matching. No raw prompt text is
                  transmitted to our servers. Detection happens entirely within the user&rsquo;s
                  browser; only metadata (entity types, counts, and scores) is sent to the
                  platform.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Pseudonymization</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  When proxy mode is active, sensitive entities are replaced with realistic
                  pseudonyms before any text leaves the user&rsquo;s organization. For example,
                  &ldquo;John Smith&rdquo; might become &ldquo;Robert Chen.&rdquo; This allows
                  employees to use AI tools productively while ensuring real sensitive data never
                  reaches third-party AI providers.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Server-Side Analysis</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  When document scanning is used, documents are processed server-side for entity
                  detection and sensitivity scoring. Extracted text is pseudonymized, and the
                  original document is not retained after processing is complete.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Encryption</h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  All data at rest is encrypted using AES-256-GCM with per-firm encryption keys
                  derived via PBKDF2. Data in transit is encrypted via TLS 1.2+. Each event is
                  wrapped with a unique data key using envelope encryption, ensuring that even in
                  the unlikely event of a breach, data cannot be read without the corresponding
                  key material.
                </p>
              </div>
            </div>
          </section>


          {/* ── 4. Data Retention ────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Data Retention</h2>

            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <div>
                  <p className="font-semibold text-gray-800 dark:text-gray-200">Event Data</p>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    Retained for the firm&rsquo;s configured retention period (default: 90 days),
                    after which it is automatically and permanently deleted.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <div>
                  <p className="font-semibold text-gray-800 dark:text-gray-200">Pseudonym Maps</p>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    Pseudonym mappings expire after 24 hours and are automatically purged. This
                    ensures that the link between real entities and their pseudonyms cannot be
                    recovered after the short-lived session window.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="mt-1 w-2 h-2 rounded-full bg-iron-500 shrink-0" />
                <div>
                  <p className="font-semibold text-gray-800 dark:text-gray-200">Audit Trail</p>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    Audit trail records are cryptographically chained and immutable. They are
                    retained in accordance with the firm&rsquo;s configured retention policy
                    to support compliance and regulatory requirements.
                  </p>
                </div>
              </div>
            </div>
          </section>


          {/* ── 5. Your Rights (GDPR) ───────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Your Rights (GDPR)</h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
              If you are located in the European Economic Area or a jurisdiction with similar data
              protection laws, you have the following rights regarding your personal data:
            </p>

            <div className="space-y-5">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-100 dark:border-gray-800">
                <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Right to Access</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                  You can export your data at any time via our API using the{' '}
                  <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono text-iron-600 dark:text-iron-400">
                    GET /v1/user/export
                  </code>{' '}
                  endpoint. This returns a complete copy of all data we hold about you.
                </p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-100 dark:border-gray-800">
                <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Right to Erasure</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                  You may request complete deletion of your firm&rsquo;s data. Upon receiving a
                  valid erasure request, all related records &mdash; including event data, entity
                  detections, pseudonym maps, and account information &mdash; are permanently
                  deleted within 30 days.
                </p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-100 dark:border-gray-800">
                <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Right to Rectification</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                  You can update your account information &mdash; including your display name,
                  email address, and role &mdash; at any time through the dashboard settings.
                </p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-100 dark:border-gray-800">
                <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Right to Data Portability</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                  You can download all of your data in a machine-readable JSON format at any time,
                  making it easy to transfer your data to another service if you choose.
                </p>
              </div>
            </div>
          </section>


          {/* ── 6. Third-Party Services ──────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Third-Party Services</h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
              We use the following third-party services to operate Iron Gate. Each service has its
              own privacy policy and data handling practices:
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  name: 'Clerk',
                  purpose: 'Authentication and user management',
                },
                {
                  name: 'Stripe',
                  purpose: 'Payment processing and subscription billing',
                },
                {
                  name: 'Supabase',
                  purpose: 'Database hosting and infrastructure',
                },
                {
                  name: 'Resend',
                  purpose: 'Transactional email delivery',
                },
                {
                  name: 'PostHog',
                  purpose: 'Product analytics and usage tracking',
                },
              ].map((service) => (
                <div
                  key={service.name}
                  className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800"
                >
                  <p className="font-semibold text-gray-800 dark:text-gray-200">{service.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{service.purpose}</p>
                </div>
              ))}
            </div>
          </section>


          {/* ── 7. Security ──────────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Security</h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
              Security is foundational to Iron Gate. We implement multiple layers of protection to
              ensure your data remains safe:
            </p>

            <ul className="space-y-3">
              {[
                {
                  title: 'SOC 2 Type II Architecture',
                  desc: 'Our platform is designed to meet the controls and requirements of SOC 2 Type II certification, covering security, availability, and confidentiality.',
                },
                {
                  title: 'Per-Firm Tenant Isolation',
                  desc: 'PostgreSQL Row-Level Security (RLS) policies enforce strict data isolation at the database layer. No firm can access another firm\'s data, even in the event of an application-level vulnerability.',
                },
                {
                  title: 'Cryptographic Audit Trail',
                  desc: 'Every event is hash-chained using SHA-256. If any record is tampered with, the hash chain breaks, providing immediate and verifiable tamper detection.',
                },
                {
                  title: 'Rate Limiting and Security Monitoring',
                  desc: 'All API endpoints are rate-limited to prevent abuse. We monitor for anomalous access patterns, bulk extraction attempts, and other breach signals in real time.',
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-3 items-start">
                  <svg className="w-5 h-5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-200">{item.title}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>


          {/* ── 8. Contact ───────────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Contact</h2>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              If you have any questions about this Privacy Policy, your data, or your rights,
              please contact us at{' '}
              <a
                href="mailto:privacy@irongate.dev"
                className="text-iron-600 dark:text-iron-400 hover:text-iron-700 dark:hover:text-iron-300 underline underline-offset-2 transition-colors"
              >
                privacy@irongate.dev
              </a>
              .
            </p>
          </section>

        </div>
      </div>

      {/* ════════════════ FOOTER ════════════════ */}
      <footer className="border-t border-gray-100 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
                <ShieldCheckIcon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold">Iron Gate</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Enterprise AI Governance Platform</p>
              </div>
            </div>

            <div className="flex items-center gap-8 text-sm text-gray-400 dark:text-gray-500">
              <Link href="/" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Home</Link>
              <Link href="/demo" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Demo</Link>
              <Link href="/privacy" className="text-gray-600 dark:text-gray-300 font-medium">Privacy</Link>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">v0.3.0</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
