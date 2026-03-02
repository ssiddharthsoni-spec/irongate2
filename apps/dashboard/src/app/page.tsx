import Link from 'next/link';
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

export default function LandingPage() {
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
              Works with ChatGPT, Claude, Gemini, Copilot &amp; 6 more
            </div>

            <h1 className="text-4xl md:text-6xl font-bold leading-[1.08] tracking-tight">
              Let your team use AI.
              <br />
              <span className="bg-gradient-to-r from-iron-600 to-iron-500 dark:from-iron-400 dark:to-iron-300 bg-clip-text text-transparent">
                We&apos;ll keep the data safe.
              </span>
            </h1>

            <p className="mt-6 text-base md:text-lg text-[#6e6e73] dark:text-[#86868b] leading-relaxed max-w-2xl mx-auto">
              Iron Gate sits invisibly between your employees and AI tools &mdash;
              scanning every prompt, replacing sensitive data with safe stand-ins,
              and restoring originals in the response. Full productivity, zero data leakage.
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
          </div>
        </div>
      </section>

      {/* ════════════════ THE ROUND-TRIP (3 steps) ════════════════ */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 pb-24 md:pb-32">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">See It In Action</p>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">The full round-trip, in three steps</h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-xl mx-auto leading-relaxed">
            Your team types naturally. Iron Gate swaps sensitive data before the AI sees it,
            then restores real values in the response. No workflow changes needed.
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
      </section>

      {/* ════════════════ STATS BAR ════════════════ */}
      <section className="border-y border-[#d2d2d7]/30 dark:border-[#38383a]/40 bg-white dark:bg-[#1c1c1e]">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
            {[
              { value: '27', label: 'Entity types detected', sub: 'SSNs, names, financials & more' },
              { value: '10+', label: 'AI tools supported', sub: 'ChatGPT, Claude, Gemini, Copilot' },
              { value: '<200ms', label: 'Avg. intercept speed', sub: 'Feels instant to end users' },
              { value: 'Zero', label: 'Workflow changes', sub: 'Employees don\u2019t notice it\u2019s there' },
            ].map((stat) => (
              <div key={stat.label} className="text-center md:text-left">
                <p className="text-2xl md:text-3xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mt-1">{stat.label}</p>
                <p className="text-xs text-[#86868b] dark:text-[#636366] mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ════════════════ FEATURES ════════════════ */}
      <section id="features" className="bg-white dark:bg-[#1c1c1e] border-y border-[#d2d2d7]/30 dark:border-[#38383a]/40">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Platform</p>
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight">AI productivity with guardrails built in</h2>
            <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
              Everything your security team needs &mdash; nothing your employees notice.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>,
                title: 'Real-Time Entity Detection',
                desc: 'Identifies SSNs, client names, case numbers, and 27 entity types inline with every prompt. Employees never wait.',
                tag: 'Core',
              },
              {
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>,
                title: 'Pre-Send Interception',
                desc: 'Catches prompts and file uploads in the browser before they reach any AI tool. Nothing sensitive ever leaves.',
                tag: 'Core',
              },
              {
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>,
                title: 'Smart Pseudonymization',
                desc: 'Sensitive data is replaced with realistic fakes. The AI gives useful answers &mdash; your employees stay productive, your data stays private.',
                tag: 'Proxy',
              },
              {
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>,
                title: 'Document Scanning',
                desc: 'Scans PDF, DOCX, XLSX, and more before uploads. High-risk files are flagged or blocked automatically.',
                tag: 'Files',
              },
              {
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>,
                title: 'Executive Dashboard',
                desc: 'Full visibility into AI usage across your org &mdash; data exposure, trust scores, and risk trends in real time.',
                tag: 'Analytics',
              },
              {
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>,
                title: 'Configurable Policies',
                desc: 'Set per-team rules: block, warn, or silently redact. Control sensitivity thresholds and choose which entity types to enforce.',
                tag: 'Admin',
              },
            ].map((f) => (
              <div key={f.title} className="bg-[#fafafa] dark:bg-[#141414] rounded-2xl p-6 border border-[#d2d2d7]/30 dark:border-[#38383a]/30 hover:border-[#d2d2d7] dark:hover:border-[#48484a] transition-all hover:shadow-sm group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-iron-50 dark:bg-iron-900/20 flex items-center justify-center text-iron-600 dark:text-iron-400">
                    {f.icon}
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#636366] px-2 py-0.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded">{f.tag}</span>
                </div>
                <h3 className="text-sm font-bold mb-1.5">{f.title}</h3>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ INDUSTRIES ════════════════ */}
      <section id="industries" className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Industries</p>
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Built for teams that handle sensitive data</h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
            Custom entity detectors tuned for the data types and compliance requirements in your industry.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97Z" /></svg>,
              title: 'Law Firms',
              entities: 'Case names, matter numbers, privilege markers, opposing counsel',
              color: 'text-blue-600 dark:text-blue-400',
            },
            {
              icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" /></svg>,
              title: 'Healthcare',
              entities: 'Patient MRNs, diagnoses, insurance IDs, HIPAA-protected PHI',
              color: 'text-red-600 dark:text-red-400',
            },
            {
              icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>,
              title: 'Investment Banks',
              entities: 'Deal codenames, MNPI, ticker symbols, information barriers',
              color: 'text-green-600 dark:text-green-400',
            },
            {
              icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>,
              title: 'HR & People Ops',
              entities: 'Employee IDs, salaries, equity grants, performance reviews',
              color: 'text-purple-600 dark:text-purple-400',
            },
          ].map((ind) => (
            <div key={ind.title} className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-6 border border-[#d2d2d7]/40 dark:border-[#38383a]/40 hover:border-[#d2d2d7] dark:hover:border-[#48484a] transition-all hover:shadow-sm">
              <div className={`w-10 h-10 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] ${ind.color} flex items-center justify-center mb-4`}>
                {ind.icon}
              </div>
              <h3 className="text-sm font-bold mb-1.5">{ind.title}</h3>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] leading-relaxed">{ind.entities}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════ SECURITY ════════════════ */}
      <section id="security" className="bg-white dark:bg-[#1c1c1e] border-y border-[#d2d2d7]/30 dark:border-[#38383a]/40">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Security</p>
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Enterprise-grade security, built in</h2>
            <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
              Zero-knowledge architecture. Entity values are hashed client-side, data is encrypted per-firm, and every event is hash-chained for tamper detection.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                title: 'Zero-Knowledge Architecture',
                desc: 'Entity values are SHA-256 hashed client-side. Raw PII never reaches our servers.',
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>,
              },
              {
                title: 'AES-256 Encryption',
                desc: 'AES-256-GCM encryption with per-firm derived keys. Pseudonym mappings are encrypted at rest.',
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" /></svg>,
              },
              {
                title: 'Firm Isolation',
                desc: 'PostgreSQL Row-Level Security enforces data isolation at the database layer.',
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3H21m-3.75 3H21" /></svg>,
              },
              {
                title: 'Tamper-Proof Audit',
                desc: 'Every event is hash-chained using SHA-256. Break one link and the entire chain fails.',
                icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>,
              },
            ].map((item) => (
              <div key={item.title} className="bg-[#fafafa] dark:bg-[#141414] rounded-2xl p-6 border border-[#d2d2d7]/30 dark:border-[#38383a]/30">
                <div className="w-10 h-10 rounded-xl bg-iron-50 dark:bg-iron-900/20 flex items-center justify-center text-iron-600 dark:text-iron-400 mb-4">
                  {item.icon}
                </div>
                <h3 className="text-sm font-bold mb-1.5">{item.title}</h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#86868b] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ PRICING ════════════════ */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Pricing</p>
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Simple, transparent pricing</h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#86868b] max-w-lg mx-auto leading-relaxed">
            Start free. Upgrade when your team grows.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {/* Pro */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 border border-[#d2d2d7]/40 dark:border-[#38383a]/40 hover:border-[#d2d2d7] dark:hover:border-[#48484a] transition-all hover:shadow-sm">
            <h3 className="text-base font-bold mb-1">Pro</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mb-6">For teams getting started</p>
            <div className="mb-6">
              <span className="text-3xl font-bold">$29</span>
              <span className="text-[#6e6e73] dark:text-[#86868b] text-sm">/user/month</span>
            </div>
            <ul className="space-y-3 mb-8">
              {['10 team members', '10,000 prompts/month', 'All 27+ entity types', 'Slack + email alerts', '90-day data retention', 'API access'].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-[#424245] dark:text-[#a1a1a6]">
                  <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/sign-up" className="block w-full text-center px-5 py-2.5 rounded-xl text-sm font-semibold border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors">
              Start Free Trial
            </Link>
          </div>

          {/* Business */}
          <div className="relative bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 border-2 border-iron-500 shadow-lg shadow-iron-500/8">
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-iron-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">
              Most Popular
            </div>
            <h3 className="text-base font-bold mb-1">Business</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mb-6">For growing organizations</p>
            <div className="mb-6">
              <span className="text-3xl font-bold">$49</span>
              <span className="text-[#6e6e73] dark:text-[#86868b] text-sm">/user/month</span>
            </div>
            <ul className="space-y-3 mb-8">
              {['50 team members', '50,000 prompts/month', 'Custom detection rules', 'SIEM integration', '1-year data retention', 'Priority support', 'Webhook alerts'].map((f) => (
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
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 border border-[#d2d2d7]/40 dark:border-[#38383a]/40 hover:border-[#d2d2d7] dark:hover:border-[#48484a] transition-all hover:shadow-sm">
            <h3 className="text-base font-bold mb-1">Enterprise</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mb-6">For regulated industries</p>
            <div className="mb-6">
              <span className="text-3xl font-bold">Custom</span>
            </div>
            <ul className="space-y-3 mb-8">
              {['Unlimited prompts & members', 'Custom entity types & plugins', 'SSO & SCIM provisioning', 'Unlimited data retention', 'Dedicated support engineer', 'On-premise deployment', 'SLA guarantee'].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-[#424245] dark:text-[#a1a1a6]">
                  <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <a href="mailto:sales@irongate.ai?subject=Enterprise%20Plan%20Inquiry" className="block w-full text-center px-5 py-2.5 rounded-xl text-sm font-semibold border border-[#d2d2d7]/60 dark:border-[#38383a]/60 text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors">
              Contact Sales
            </a>
          </div>
        </div>

        <p className="text-center mt-6 text-xs text-[#86868b] dark:text-[#636366]">
          All plans include a 14-day free trial. Free tier available (500 prompts/month, 3 members).
        </p>
      </section>

      {/* ════════════════ CTA ════════════════ */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 pb-24 md:pb-32">
        <div className="relative rounded-3xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-iron-600 via-iron-700 to-purple-700" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.08),transparent_60%)]" />

          <div className="relative px-8 py-16 md:px-16 md:py-20 text-center text-white">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight mb-4">Unlock AI for your team &mdash; safely</h2>
            <p className="text-iron-100/70 max-w-lg mx-auto mb-10 text-sm md:text-base leading-relaxed">
              Install the Chrome extension, connect your team, and your employees start using AI productively &mdash; with every prompt protected.
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
