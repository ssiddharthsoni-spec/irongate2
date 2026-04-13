import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import LandingNav from '@/components/LandingNav';

/* ── Reusable icon components ─────────────────────────────────────────── */
function ShieldCheckIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

function CheckIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function ArrowRightIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

export default async function LandingPage() {
  // Server-side redirect: signed-in users go straight to dashboard
  try {
    const { userId } = await auth();
    if (userId) redirect('/dashboard');
  } catch {
    // Auth not available — show landing page
  }

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#1d1d1f] dark:text-[#f5f5f7] overflow-x-hidden antialiased">

      {/* ════════════════ NAV ════════════════ */}
      <LandingNav />

      {/* ════════════════ HERO ════════════════ */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-28">
        <div className="absolute top-20 -left-32 w-96 h-96 bg-iron-400/8 dark:bg-iron-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 -right-32 w-80 h-80 bg-purple-400/6 dark:bg-purple-600/6 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 md:px-12">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-iron-50 dark:bg-iron-900/20 border border-iron-200/60 dark:border-iron-800/60 text-iron-700 dark:text-iron-300 text-xs font-medium mb-8">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              100% local detection &middot; ChatGPT, Claude, Gemini, Copilot &amp; 6 more
            </div>

            <h1 className="text-4xl md:text-6xl font-bold leading-[1.08] tracking-tight">
              Let your team use AI.
              <br />
              <span className="bg-gradient-to-r from-iron-600 to-iron-500 dark:from-iron-400 dark:to-iron-300 bg-clip-text text-transparent">
                Your data stays on-device.
              </span>
            </h1>

            <p className="mt-6 text-base md:text-lg text-[#6e6e73] dark:text-[#86868b] leading-relaxed max-w-2xl mx-auto">
              Iron Gate detects sensitive data in your browser &mdash; before it reaches ChatGPT,
              Claude, or any AI tool. Names, SSNs, and client data are swapped for realistic
              stand-ins. The AI sees sanitized text. Your employees see real answers.
              Nothing sensitive ever leaves the device.
            </p>

            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link
                href="/sign-up"
                className="group px-6 py-3 bg-iron-600 hover:bg-iron-700 text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-iron-600/20 flex items-center gap-2"
              >
                Start Free Trial
                <ArrowRightIcon className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/demo"
                className="px-6 py-3 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] font-semibold rounded-xl text-sm transition-colors border border-[#d2d2d7]/60 dark:border-[#38383a]/60"
              >
                See Live Demo
              </Link>
            </div>

            <p className="mt-6 text-xs text-[#86868b] dark:text-[#636366]">
              Built for law firms, healthcare, finance, and regulated industries.
            </p>
          </div>
        </div>
      </section>

      {/* ════════════════ THE ROUND-TRIP (3 steps) ════════════════ */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 pb-24 md:pb-32">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">The full round-trip, in three steps</h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-xl mx-auto leading-relaxed">
            Your team types naturally. Iron Gate swaps sensitive data before the AI sees it,
            then restores real values in the response.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 max-w-6xl mx-auto">
          {/* Step 1: What the employee typed */}
          <div className="rounded-2xl border border-red-200/80 dark:border-red-900/40 overflow-hidden bg-white dark:bg-[#1c1c1e]">
            <div className="px-5 py-3 flex items-center gap-3 border-b border-red-200/60 dark:border-red-900/30 bg-red-50/60 dark:bg-red-950/20">
              <span className="w-6 h-6 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">1</span>
              <span className="text-xs font-semibold text-red-700 dark:text-red-400">Employee types a prompt</span>
            </div>
            <div className="p-5 text-[13px] text-[#424245] dark:text-[#a1a1a6] leading-[1.7] font-mono">
              Draft a memo about the <span className="bg-red-100/80 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-1 rounded font-semibold">Johnson v. Acme Corp</span> case. My client <span className="bg-red-100/80 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-1 rounded font-semibold">Robert Johnson</span> (SSN: <span className="bg-red-100/80 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-1 rounded font-semibold">423-55-8901</span>) is seeking <span className="bg-red-100/80 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-1 rounded font-semibold">$4.2M</span> in damages.
            </div>
          </div>

          {/* Step 2: What the AI receives */}
          <div className="rounded-2xl border border-green-200/80 dark:border-green-900/40 overflow-hidden bg-white dark:bg-[#1c1c1e]">
            <div className="px-5 py-3 flex items-center gap-3 border-b border-green-200/60 dark:border-green-900/30 bg-green-50/60 dark:bg-green-950/20">
              <span className="w-6 h-6 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="text-xs font-semibold text-green-700 dark:text-green-400">AI receives safe version</span>
            </div>
            <div className="p-5 text-[13px] text-[#424245] dark:text-[#a1a1a6] leading-[1.7] font-mono">
              Draft a memo about the <span className="bg-green-100/80 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-1 rounded font-semibold">Doe v. Beta Inc</span> case. My client <span className="bg-green-100/80 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-1 rounded font-semibold">John Doe</span> (SSN: <span className="bg-green-100/80 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-1 rounded font-semibold">***-**-****</span>) is seeking <span className="bg-green-100/80 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-1 rounded font-semibold">$[REDACTED]</span> in damages.
            </div>
          </div>

          {/* Step 3: What the employee gets back */}
          <div className="rounded-2xl border border-blue-200/80 dark:border-blue-900/40 overflow-hidden bg-white dark:bg-[#1c1c1e]">
            <div className="px-5 py-3 flex items-center gap-3 border-b border-blue-200/60 dark:border-blue-900/30 bg-blue-50/60 dark:bg-blue-950/20">
              <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Employee sees real response</span>
            </div>
            <div className="p-5 text-[13px] text-[#424245] dark:text-[#a1a1a6] leading-[1.7] font-mono">
              <span className="text-[11px] uppercase tracking-wide text-blue-500 dark:text-blue-400 font-semibold block mb-2">AI Response (originals restored)</span>
              Re: <span className="bg-blue-100/80 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1 rounded font-semibold">Johnson v. Acme Corp</span><br /><br />
              This memo summarizes the claims of <span className="bg-blue-100/80 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1 rounded font-semibold">Robert Johnson</span> seeking damages of <span className="bg-blue-100/80 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1 rounded font-semibold">$4.2M</span>. Under the applicable statute&hellip;
            </div>
          </div>
        </div>

        {/* Flow pills */}
        <div className="flex items-center justify-center gap-3 mt-6 text-[11px] text-[#86868b] dark:text-[#636366]">
          <span className="px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 font-semibold">Intercept</span>
          <ArrowRightIcon className="w-3.5 h-3.5" />
          <span className="px-3 py-1 rounded-full bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 font-semibold">Pseudonymize</span>
          <ArrowRightIcon className="w-3.5 h-3.5" />
          <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-semibold">Restore</span>
        </div>
        <p className="text-center mt-5 text-[11px] text-[#86868b] dark:text-[#636366] max-w-xl mx-auto leading-relaxed">
          Steps 1 and 3 happen entirely in the browser. Only the sanitized Step 2
          reaches the AI provider. Iron Gate itself never sees your prompts.
        </p>
      </section>

      {/* ════════════════ ARCHITECTURE ════════════════ */}
      <section id="architecture" className="max-w-7xl mx-auto px-6 md:px-12 pb-24 md:pb-32">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Three layers of local detection</h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-xl mx-auto leading-relaxed">
            Every prompt passes through the local pipeline before it ever reaches an AI tool.
            No network calls for detection. No cloud LLM sees your content.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 max-w-6xl mx-auto">
          {/* Tier 1 */}
          <div className="rounded-2xl border border-[#d2d2d7]/40 dark:border-[#38383a]/40 bg-white dark:bg-[#1c1c1e] p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-md bg-iron-50 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 text-[10px] font-bold uppercase tracking-wider">Tier 1</span>
              <span className="text-[11px] text-[#86868b] dark:text-[#636366]">~5ms</span>
            </div>
            <h3 className="text-base font-bold mb-1.5">Regex + context scorer</h3>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-3">
              30+ entity types, 4 scoring layers (entities, context, document type, intent).
              Runs as pure JavaScript in the browser — no network, no LLM.
            </p>
            <p className="text-[11px] text-[#86868b] dark:text-[#636366] font-mono">
              SSN · Credit cards · Names · Orgs · Routing · VINs · API keys · ...
            </p>
          </div>

          {/* Tier 2 */}
          <div className="rounded-2xl border border-[#d2d2d7]/40 dark:border-[#38383a]/40 bg-white dark:bg-[#1c1c1e] p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-md bg-iron-50 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 text-[10px] font-bold uppercase tracking-wider">Tier 2</span>
              <span className="text-[11px] text-[#86868b] dark:text-[#636366]">~500ms</span>
            </div>
            <h3 className="text-base font-bold mb-1.5">Local LLM (optional)</h3>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-3">
              Ollama + Llama 3.2 3B on the employee&apos;s machine resolves ambiguous cases.
              Talks only to <span className="font-mono">localhost:11434</span>.
            </p>
            <p className="text-[11px] text-[#86868b] dark:text-[#636366]">
              Skipped gracefully if Ollama isn&apos;t installed.
            </p>
          </div>

          {/* Pseudonymization */}
          <div className="rounded-2xl border border-[#d2d2d7]/40 dark:border-[#38383a]/40 bg-white dark:bg-[#1c1c1e] p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-md bg-iron-50 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 text-[10px] font-bold uppercase tracking-wider">Swap</span>
              <span className="text-[11px] text-[#86868b] dark:text-[#636366]">~1ms</span>
            </div>
            <h3 className="text-base font-bold mb-1.5">Pseudonymization</h3>
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b] leading-relaxed mb-3">
              HKDF-SHA256 generates deterministic fake names via browser-native crypto.
              Reverse map held in memory only — never written to disk, never synced.
            </p>
            <p className="text-[11px] text-[#86868b] dark:text-[#636366] font-mono">
              Sarah Johnson → Emily Rogers
            </p>
          </div>
        </div>

        {/* Guarantee line */}
        <div className="mt-10 max-w-3xl mx-auto">
          <div className="rounded-xl border border-iron-200/60 dark:border-iron-800/40 bg-iron-50/60 dark:bg-iron-900/10 px-5 py-4 flex items-start gap-3">
            <ShieldCheckIcon className="w-5 h-5 text-iron-600 dark:text-iron-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-iron-800 dark:text-iron-200">Zero prompt text reaches Iron Gate</p>
              <p className="text-xs text-iron-700/80 dark:text-iron-300/70 leading-relaxed mt-1">
                The audit log contains entity types, counts, and SHA-256 hashes &mdash; never raw text
                or PII values. Our database has no column for prompt content. Structurally impossible to leak.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ FEATURES ════════════════ */}
      <section id="features" className="bg-white dark:bg-[#1c1c1e] border-y border-[#d2d2d7]/30 dark:border-[#38383a]/40">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-28">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Everything your security team needs</h2>
            <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
              Nothing your employees notice.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {[
              {
                title: 'Local-First Detection',
                desc: '30+ entity types caught in the browser in under 10ms. Optional local LLM (Ollama) for ambiguous cases. Zero cloud calls for detection.',
              },
              {
                title: '10 AI Tools Protected',
                desc: 'ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Poe, Groq, HuggingFace, You.com. One install, all the tools your team uses.',
              },
              {
                title: 'Invisible to Employees',
                desc: 'No blocking screens, no prompts to rewrite. Pseudonyms go out, originals come back. Employees keep their ChatGPT workflow unchanged.',
              },
              {
                title: 'Zero-Touch Enterprise Deployment',
                desc: 'IT pushes the extension via Google Workspace, Intune, or Jamf. Employees auto-enroll via managed policy &mdash; no sign-up, no API keys.',
              },
              {
                title: 'Admin Dashboard',
                desc: 'Aggregate visibility into AI usage: which tools, what entity types, how often. No prompt text ever stored &mdash; only anonymized metadata.',
              },
              {
                title: 'Compliance-Ready Audit Log',
                desc: 'Hash-chained, HMAC-signed event log built for HIPAA, PCI-DSS, GDPR, and SOC 2. Exportable as CSV for auditors.',
              },
            ].map((f) => (
              <div key={f.title} className="bg-[#fafafa] dark:bg-[#141414] rounded-2xl p-6 border border-[#d2d2d7]/30 dark:border-[#38383a]/30">
                <h3 className="text-sm font-bold mb-1.5">{f.title}</h3>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] leading-relaxed" dangerouslySetInnerHTML={{ __html: f.desc }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ SECURITY ════════════════ */}
      <section id="security" className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-28">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Sovereign by default</h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
            Local-only mode is the default. Cloud escalation requires explicit IT opt-in.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto text-center">
          {[
            { title: 'Local-Only Default', desc: 'No cloud LLM calls unless IT opts in' },
            { title: 'Zero Persistence', desc: 'No DB column for prompt text' },
            { title: 'HKDF-SHA256', desc: 'Browser-native pseudonymization' },
            { title: 'AES-256-GCM', desc: 'Per-firm derived encryption keys' },
            { title: 'Ed25519 Policy Signing', desc: 'Tamper-proof policy bundles' },
            { title: 'Hash-Chained Audit', desc: 'HMAC-signed event trail' },
            { title: 'Row-Level Security', desc: 'Firm isolation at the DB layer' },
            { title: 'Managed Policy Lock', desc: 'Config immutable once IT deploys' },
          ].map((item) => (
            <div key={item.title}>
              <p className="text-sm font-bold mb-1">{item.title}</p>
              <p className="text-xs text-[#86868b] dark:text-[#636366] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 max-w-2xl mx-auto text-center">
          <p className="text-xs text-[#86868b] dark:text-[#636366] leading-relaxed">
            Defense in depth &mdash; three independent checks prevent any cloud call during detection:
            {' '}the tier-3 adapter is disabled by default, the managed-config layer enforces local-only,
            and every cloud call site asserts permission before making a request. Architecture invariants
            are enforced by 2,000+ tests on every commit.
          </p>
        </div>
      </section>

      {/* ════════════════ PRICING ════════════════ */}
      <section id="pricing" className="bg-white dark:bg-[#1c1c1e] border-y border-[#d2d2d7]/30 dark:border-[#38383a]/40">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-28">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Simple pricing</h2>
            <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
              Start free. Upgrade when your team grows.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {/* Basic */}
            <div className="bg-[#fafafa] dark:bg-[#141414] rounded-2xl p-7 border border-[#d2d2d7]/40 dark:border-[#38383a]/40">
              <h3 className="text-base font-bold mb-1">Basic</h3>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mb-5">For individuals</p>
              <div className="mb-5">
                <span className="text-3xl font-bold">Free</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {['All AI platforms', 'Audit mode', 'Regex detection', 'Unlimited scans'].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-[#424245] dark:text-[#a1a1a6]">
                    <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/sign-up" className="block w-full text-center px-5 py-2.5 rounded-xl text-sm font-semibold border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-[#424245] dark:text-[#a1a1a6] hover:bg-white dark:hover:bg-[#2c2c2e] transition-colors">
                Get Started
              </Link>
            </div>

            {/* Pro */}
            <div className="relative bg-white dark:bg-[#1c1c1e] rounded-2xl p-7 border-2 border-iron-500 shadow-lg shadow-iron-500/8">
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-iron-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">
                Most Popular
              </div>
              <h3 className="text-base font-bold mb-1">Pro</h3>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mb-5">For teams</p>
              <div className="mb-5">
                <span className="text-3xl font-bold">$18</span>
                <span className="text-[#6e6e73] dark:text-[#86868b] text-sm">/user/mo</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {['Everything in Basic', 'ML-powered detection', 'Proxy mode (auto-redact)', 'Admin dashboard', 'Compliance export', '15-day free trial'].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-[#424245] dark:text-[#a1a1a6]">
                    <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/sign-up" className="block w-full text-center px-5 py-2.5 rounded-xl text-sm font-semibold bg-iron-600 text-white hover:bg-iron-700 transition-colors">
                Start Free Trial
              </Link>
            </div>

            {/* Enterprise */}
            <div className="bg-[#fafafa] dark:bg-[#141414] rounded-2xl p-7 border border-[#d2d2d7]/40 dark:border-[#38383a]/40">
              <h3 className="text-base font-bold mb-1">Enterprise</h3>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mb-5">For regulated industries</p>
              <div className="mb-5">
                <span className="text-3xl font-bold">Custom</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {['Everything in Pro', 'Unlimited users', 'SSO & SCIM', 'SIEM integration', 'On-premise option', 'SLA guarantee'].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-[#424245] dark:text-[#a1a1a6]">
                    <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <a href="mailto:sales@irongate.ai?subject=Enterprise%20Plan%20Inquiry" className="block w-full text-center px-5 py-2.5 rounded-xl text-sm font-semibold border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-[#424245] dark:text-[#a1a1a6] hover:bg-white dark:hover:bg-[#2c2c2e] transition-colors">
                Contact Sales
              </a>
            </div>
          </div>

          <p className="text-center mt-6 text-xs text-[#86868b] dark:text-[#636366]">
            All paid plans include a 15-day free Pro trial. Basic plan is free forever.
          </p>
        </div>
      </section>

      {/* ════════════════ CTA ════════════════ */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-28">
        <div className="relative rounded-3xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-iron-600 via-iron-700 to-purple-700" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.08),transparent_60%)]" />

          <div className="relative px-8 py-16 md:px-16 md:py-20 text-center text-white">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight mb-4">Unlock AI for your team &mdash; safely</h2>
            <p className="text-iron-100/70 max-w-lg mx-auto mb-10 text-sm md:text-base leading-relaxed">
              Install the Chrome extension, connect your team, and start using AI productively &mdash; with every prompt protected.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/sign-up"
                className="group px-6 py-3 bg-white text-iron-700 font-semibold rounded-xl text-sm hover:bg-iron-50 transition-all shadow-lg flex items-center gap-2"
              >
                Start Free Trial
                <ArrowRightIcon className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/demo"
                className="px-6 py-3 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-xl text-sm transition-all border border-white/20"
              >
                See Live Demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ FOOTER ════════════════ */}
      <footer className="border-t border-[#d2d2d7]/30 dark:border-[#38383a]/40">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-iron-600 rounded-lg flex items-center justify-center">
                <ShieldCheckIcon className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold">Iron Gate</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#636366]">Safe AI for every team</p>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs text-[#86868b] dark:text-[#636366]">
              <a href="#architecture" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">How It Works</a>
              <a href="#features" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Features</a>
              <a href="#security" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Security</a>
              <a href="#pricing" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Pricing</a>
              <Link href="/demo" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Demo</Link>
              <Link href="/privacy" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">Terms</Link>
            </div>

            <p className="text-[11px] text-[#86868b] dark:text-[#636366]">&copy; {new Date().getFullYear()} Iron Gate</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
