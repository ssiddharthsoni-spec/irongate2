import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — Iron Gate',
  description: 'Terms of Service for the Iron Gate AI Governance Platform.',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-[#1d1d1f] dark:text-[#f5f5f7]">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-lg border-b border-[#d2d2d7]/30 dark:border-[#38383a]/40/50">
        <div className="flex items-center justify-between px-6 md:px-12 py-3 max-w-7xl mx-auto">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-iron-600 rounded-lg flex items-center justify-center shadow-lg shadow-iron-600/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">Iron Gate</span>
          </Link>

          <Link
            href="/"
            className="text-sm text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>
      </nav>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16 md:py-24">

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          Terms of Service
        </h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-12">
          Last updated: February 2026
        </p>

        {/* ── 1. Acceptance of Terms ───────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">1. Acceptance of Terms</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            By accessing or using Iron Gate (&quot;the Service&quot;), you agree to be bound by
            these Terms of Service (&quot;Terms&quot;). If you do not agree to all of these
            Terms, you may not access or use the Service. These Terms constitute a
            legally binding agreement between you and Iron Gate.
          </p>
        </section>

        {/* ── 2. Description of Service ────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">2. Description of Service</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            Iron Gate is an enterprise AI governance platform. The Service provides
            tools for monitoring and protecting sensitive data in AI tool interactions,
            including:
          </p>
          <ul className="list-disc list-inside mt-4 space-y-2 text-[#6e6e73] dark:text-[#86868b]">
            <li>A Chrome browser extension that intercepts and analyzes prompts sent to AI tools</li>
            <li>A web-based dashboard for monitoring, analytics, compliance, and administration</li>
            <li>A REST API for programmatic access to detection, audit, and reporting capabilities</li>
          </ul>
        </section>

        {/* ── 3. Account Terms ─────────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">3. Account Terms</h2>
          <ul className="list-disc list-inside space-y-2 text-[#6e6e73] dark:text-[#86868b]">
            <li>
              You must provide accurate and complete information when creating an
              account. You are responsible for keeping your account information
              up to date.
            </li>
            <li>
              You are responsible for maintaining the security of your account
              credentials. Iron Gate is not liable for any loss or damage arising
              from unauthorized access to your account.
            </li>
            <li>
              One person or automated bot may not maintain more than one account.
              Duplicate accounts may be suspended or terminated without notice.
            </li>
            <li>
              You must be at least 18 years of age to use the Service. By creating
              an account, you represent and warrant that you meet this requirement.
            </li>
          </ul>
        </section>

        {/* ── 4. Subscription and Billing ──────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">4. Subscription and Billing</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-4">
            Iron Gate offers the following subscription tiers:
          </p>

          <div className="overflow-hidden rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/40 mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f5f5f7] dark:bg-[#141414] text-left">
                  <th className="px-5 py-3 font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Tier</th>
                  <th className="px-5 py-3 font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Prompts / Month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
                <tr>
                  <td className="px-5 py-3 text-[#424245] dark:text-[#a1a1a6]">Free</td>
                  <td className="px-5 py-3 text-[#6e6e73] dark:text-[#86868b]">500</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-[#424245] dark:text-[#a1a1a6]">Pro</td>
                  <td className="px-5 py-3 text-[#6e6e73] dark:text-[#86868b]">10,000</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-[#424245] dark:text-[#a1a1a6]">Business</td>
                  <td className="px-5 py-3 text-[#6e6e73] dark:text-[#86868b]">100,000</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-[#424245] dark:text-[#a1a1a6]">Enterprise</td>
                  <td className="px-5 py-3 text-[#6e6e73] dark:text-[#86868b]">Unlimited (custom pricing)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul className="list-disc list-inside space-y-2 text-[#6e6e73] dark:text-[#86868b]">
            <li>All billing is processed securely through Stripe. Iron Gate does not store your payment card details.</li>
            <li>Paid subscriptions renew automatically at the end of each billing cycle. You may cancel at any time via the billing portal; your plan will remain active until the end of the current period.</li>
          </ul>
        </section>

        {/* ── 5. Acceptable Use ────────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">5. Acceptable Use</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-4">
            You agree not to misuse the Service. The following activities are
            expressly prohibited:
          </p>
          <ul className="list-disc list-inside space-y-2 text-[#6e6e73] dark:text-[#86868b]">
            <li>Reverse-engineering, decompiling, disassembling, or otherwise attempting to derive the source code of the Service or its underlying algorithms.</li>
            <li>Using the Service to facilitate, promote, or engage in any illegal activity.</li>
            <li>Attempting to bypass security controls, access another firm&apos;s data, or exploit vulnerabilities in the platform.</li>
            <li>Exceeding published rate limits, abusing the API, or placing unreasonable load on the infrastructure.</li>
            <li>Interfering with or disrupting the integrity or performance of the Service.</li>
          </ul>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mt-4">
            Violation of this section may result in immediate suspension or
            termination of your account.
          </p>
        </section>

        {/* ── 6. Data and Privacy ──────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">6. Data and Privacy</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            We handle your data as described in our Privacy Policy. Iron Gate is
            built on a zero-knowledge architecture: sensitive entity values are
            hashed client-side and encrypted with per-event AES-256-GCM keys. We
            do not have access to your raw data. For full details, see our{' '}
            <Link href="/privacy" className="text-iron-600 dark:text-iron-400 underline hover:text-iron-700 dark:hover:text-iron-300 transition-colors">
              Privacy Policy
            </Link>.
          </p>
        </section>

        {/* ── 7. Intellectual Property ─────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">7. Intellectual Property</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            Iron Gate, its logo, and all associated software, documentation, and
            visual designs are the exclusive property of Iron Gate and are protected
            by applicable intellectual property laws. You may not use our trademarks
            without prior written consent. You retain full ownership of any data you
            submit through the Service. We claim no intellectual property rights over
            the content you provide.
          </p>
        </section>

        {/* ── 8. Service Availability ──────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">8. Service Availability</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            We strive to maintain high availability of the Service at all times.
            However, we do not guarantee 100% uptime. The Service may be temporarily
            unavailable due to scheduled maintenance, infrastructure upgrades, or
            circumstances beyond our control. We will make reasonable efforts to
            notify you of planned maintenance windows in advance when possible.
          </p>
        </section>

        {/* ── 9. Limitation of Liability ───────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">9. Limitation of Liability</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-4">
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties
            of any kind, whether express or implied, including but not limited to
            implied warranties of merchantability, fitness for a particular purpose,
            and non-infringement.
          </p>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-4">
            To the maximum extent permitted by applicable law, Iron Gate shall not be
            liable for any indirect, incidental, special, consequential, or punitive
            damages, or any loss of profits, data, use, or goodwill, however caused,
            whether in contract, tort, or otherwise, even if Iron Gate has been
            advised of the possibility of such damages.
          </p>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            In no event shall Iron Gate&apos;s total aggregate liability exceed the amount
            you paid to Iron Gate in the twelve (12) months immediately preceding the
            event giving rise to the claim.
          </p>
        </section>

        {/* ── 10. Termination ──────────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">10. Termination</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            Either party may terminate this agreement at any time and for any reason.
            You may terminate by cancelling your subscription and ceasing use of the
            Service. Iron Gate may terminate or suspend your access if you violate
            these Terms. Upon termination, your data will be retained for thirty (30)
            days to allow for export, after which it will be permanently and
            irrecoverably deleted from our systems.
          </p>
        </section>

        {/* ── 11. Changes to Terms ─────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">11. Changes to Terms</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            We reserve the right to modify these Terms at any time. When we make
            material changes, we will update the &quot;Last updated&quot; date at the top of
            this page and, where appropriate, notify you via email or an in-app
            notification. Your continued use of the Service after the effective date
            of any changes constitutes your acceptance of the revised Terms.
          </p>
        </section>

        {/* ── 12. Governing Law ────────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">12. Governing Law</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            These Terms shall be governed by and construed in accordance with the
            laws of the State of Delaware, United States, without regard to its
            conflict-of-law provisions. Any disputes arising from or relating to
            these Terms or the Service shall be subject to the exclusive jurisdiction
            of the state and federal courts located in Delaware.
          </p>
        </section>

        {/* ── 13. Contact ──────────────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">13. Contact</h2>
          <p className="text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            If you have any questions about these Terms, please contact us at{' '}
            <a
              href="mailto:legal@irongate.dev"
              className="text-iron-600 dark:text-iron-400 underline hover:text-iron-700 dark:hover:text-iron-300 transition-colors"
            >
              legal@irongate.dev
            </a>.
          </p>
        </section>

      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#d2d2d7]/30 dark:border-[#38383a]/40/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold">Iron Gate</p>
                <p className="text-xs text-[#86868b] dark:text-[#636366]">Enterprise AI Governance Platform</p>
              </div>
            </div>

            <div className="flex items-center gap-8 text-sm text-[#86868b] dark:text-[#636366]">
              <Link href="/privacy" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Terms</Link>
              <Link href="/demo" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Demo</Link>
            </div>

            <p className="text-xs text-[#86868b] dark:text-[#636366]">&copy; 2026 Iron Gate. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
