import Link from 'next/link';

/* ── Reusable icon components ─────────────────────────────────────────── */
function ShieldCheckIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white overflow-x-hidden">

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
            <a href="#features" className="hidden md:block text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hidden md:block text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">How It Works</a>
            <a href="#security" className="hidden md:block text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Security</a>
            <a href="#industries" className="hidden md:block text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Industries</a>
            <Link href="/sign-in" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/demo" className="hidden sm:inline-flex text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              Live Demo
            </Link>
            <Link href="/sign-up" className="px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-semibold rounded-lg transition-all shadow-md shadow-iron-600/20 hover:shadow-lg hover:shadow-iron-600/30">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ════════════════ HERO ════════════════ */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
        {/* Background gradient orbs */}
        <div className="absolute top-20 -left-32 w-96 h-96 bg-iron-400/10 dark:bg-iron-600/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-32 w-80 h-80 bg-purple-400/10 dark:bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-64 bg-iron-400/5 dark:bg-iron-600/5 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6 md:px-12">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-iron-50 dark:bg-iron-900/30 border border-iron-200 dark:border-iron-800 text-iron-700 dark:text-iron-300 text-xs font-semibold mb-8 tracking-wide uppercase">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Monitoring ChatGPT, Claude, Gemini, Copilot &amp; more
            </div>

            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.08] tracking-tight">
              Your employees use AI.
              <br />
              <span className="bg-gradient-to-r from-iron-600 via-iron-500 to-purple-500 dark:from-iron-400 dark:via-iron-300 dark:to-purple-400 bg-clip-text text-transparent">
                Iron Gate keeps it safe.
              </span>
            </h1>

            <p className="mt-8 text-lg md:text-xl text-gray-500 dark:text-gray-400 leading-relaxed max-w-2xl mx-auto">
              The invisible governance layer that detects sensitive data in every AI prompt,
              blocks it before it leaves your network, and gives you complete visibility.
            </p>

            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/sign-up"
                className="group px-7 py-3.5 bg-iron-600 hover:bg-iron-700 text-white font-semibold rounded-xl text-base transition-all shadow-xl shadow-iron-600/25 hover:shadow-2xl hover:shadow-iron-600/30 flex items-center gap-2"
              >
                Get Started Free
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/demo"
                className="px-7 py-3.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-semibold rounded-xl text-base transition-colors"
              >
                Try Live Demo
              </Link>
            </div>

            {/* Trust strip */}
            <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-gray-400 dark:text-gray-500 font-medium">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                Zero-Knowledge Architecture
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                AES-256-GCM Encryption
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                SOC 2 Type II Ready
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                Row-Level Security Isolation
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                Kill Switch Emergency Stop
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                GDPR Right-to-Erasure
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ STATS BAR ════════════════ */}
      <section className="border-y border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {[
              { value: '2,847', label: 'Interactions monitored', sub: 'last 30 days' },
              { value: '187', label: 'Sensitive prompts caught', sub: 'before reaching AI' },
              { value: 'AES-256', label: 'Envelope encryption', sub: 'per-event unique keys' },
              { value: '<200ms', label: 'Detection latency', sub: 'zero user friction' },
            ].map((stat) => (
              <div key={stat.label} className="text-center md:text-left">
                <p className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">{stat.value}</p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">{stat.label}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ HOW IT WORKS ════════════════ */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">How It Works</p>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">Seven steps. Zero data loss.</h2>
          <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            Iron Gate operates as an invisible layer between your employees and AI tools.
          </p>
        </div>

        <div className="grid md:grid-cols-7 gap-4">
          {[
            { step: '01', title: 'Capture', desc: 'Browser extension intercepts every prompt and file upload to ChatGPT, Claude, Gemini, and Copilot.', color: 'from-iron-500 to-iron-600' },
            { step: '02', title: 'Hash', desc: 'Entity values are SHA-256 hashed client-side with a per-session salt. Raw PII never leaves the browser.', color: 'from-iron-600 to-cyan-500' },
            { step: '03', title: 'Detect', desc: '25+ entity detectors scan for SSNs, case names, deal codenames, client data, and privileged content.', color: 'from-cyan-500 to-purple-500' },
            { step: '04', title: 'Score', desc: 'Weighted sensitivity scoring with firm-specific rules, client-matter matching, and context awareness.', color: 'from-purple-500 to-purple-600' },
            { step: '05', title: 'Encrypt', desc: 'Envelope encryption wraps each event with a unique AES-256-GCM data key, sealed by the firm\'s KMS master key.', color: 'from-purple-600 to-amber-500' },
            { step: '06', title: 'Decide', desc: 'Based on your thresholds: allow, warn, pseudonymize, or block. Configurable per team or user.', color: 'from-amber-500 to-pink-500' },
            { step: '07', title: 'Protect', desc: 'Sensitive data is blocked or replaced with pseudonyms. Audit trail hash-chained for tamper evidence.', color: 'from-pink-500 to-red-500' },
          ].map((item) => (
            <div key={item.step} className="relative group">
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 h-full hover:border-iron-200 dark:hover:border-iron-800 transition-all hover:shadow-lg">
                <div className={`inline-flex w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} items-center justify-center mb-4 shadow-md`}>
                  <span className="text-white text-xs font-bold">{item.step}</span>
                </div>
                <h3 className="text-base font-bold mb-2">{item.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 text-iron-600 dark:text-iron-400 font-semibold text-sm hover:text-iron-700 dark:hover:text-iron-300 transition-colors"
          >
            Watch the full pipeline in action
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ════════════════ FEATURES ════════════════ */}
      <section id="features" className="bg-gray-50 dark:bg-gray-900/40 border-y border-gray-100 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Platform</p>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">Everything you need to govern AI</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>,
                title: 'Real-Time Entity Detection',
                desc: 'Identifies SSNs, client names, case numbers, deal codenames, privileged content, and 25+ entity types the instant they are typed.',
                tag: 'Core',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>,
                title: 'Pre-Send Blocking',
                desc: 'Intercepts prompts and document uploads at the network level. Sensitive data is stopped before it ever reaches ChatGPT, Claude, or Gemini.',
                tag: 'Core',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>,
                title: 'Smart Pseudonymization',
                desc: 'In proxy mode, sensitive entities are replaced with format-preserving pseudonyms. The AI still works — but with fake data instead of real PII.',
                tag: 'Proxy',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>,
                title: 'Document Scanning',
                desc: 'Scans PDF, DOCX, XLSX, CSV, and TXT uploads before they reach AI tools. Extracts text, detects entities, and blocks risky files.',
                tag: 'Files',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>,
                title: 'Executive Dashboard',
                desc: 'Full visibility into who is using what AI tool, what data is being shared, exposure reports, trust scores, and organizational risk.',
                tag: 'Analytics',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>,
                title: 'Tamper-Proof Audit Trail',
                desc: 'Every AI interaction is logged in a blockchain-style chain with SHA-256 hashing. Verify integrity at any time for regulatory compliance.',
                tag: 'Compliance',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" /></svg>,
                title: 'Envelope Encryption',
                desc: 'Every event is encrypted with a unique AES-256-GCM data key, wrapped by the firm\'s KMS master key. Zero-knowledge architecture — we never see your data.',
                tag: 'Security',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285ZM12 15.75h.008v.008H12v-.008Z" /></svg>,
                title: 'Kill Switch & Breach Detection',
                desc: 'Global or per-firm emergency shutdown with dual-key authentication. 7 breach signals monitored in real-time with automated escalation.',
                tag: 'Security',
              },
              {
                icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>,
                title: 'Row-Level Security & RBAC',
                desc: 'PostgreSQL RLS policies enforce per-firm data isolation at the database layer. Role-based access control with 21 fine-grained permissions.',
                tag: 'Infrastructure',
              },
            ].map((f) => (
              <div key={f.title} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:shadow-lg transition-all group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 rounded-xl bg-iron-50 dark:bg-iron-900/30 flex items-center justify-center text-iron-600 dark:text-iron-400 group-hover:bg-iron-100 dark:group-hover:bg-iron-900/50 transition-colors">
                    {f.icon}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded-md">{f.tag}</span>
                </div>
                <h3 className="text-base font-bold mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ INDUSTRIES ════════════════ */}
      <section id="industries" className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Industries</p>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">Built for regulated industries</h2>
          <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            Iron Gate ships with industry-specific detection models tuned for the entities and compliance requirements that matter most.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97Z" /></svg>,
              title: 'Law Firms',
              entities: 'Case names, matter numbers, privilege markers, opposing counsel, client-matter pairs',
              color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
            },
            {
              icon: <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" /></svg>,
              title: 'Healthcare',
              entities: 'Patient MRNs, diagnoses, lab results, insurance IDs, HIPAA-protected PHI, mental health records',
              color: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
            },
            {
              icon: <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>,
              title: 'Investment Banks',
              entities: 'Deal codenames, MNPI, ticker symbols, offer prices, commitment letters, information barriers',
              color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
            },
            {
              icon: <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>,
              title: 'HR & People Ops',
              entities: 'Employee IDs, salaries, equity grants, FMLA data, performance reviews, HR complaints',
              color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
            },
          ].map((ind) => (
            <div key={ind.title} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:shadow-lg transition-all">
              <div className={`w-12 h-12 rounded-xl ${ind.color} flex items-center justify-center mb-5`}>
                {ind.icon}
              </div>
              <h3 className="text-lg font-bold mb-2">{ind.title}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{ind.entities}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 text-iron-600 dark:text-iron-400 font-semibold text-sm hover:text-iron-700 dark:hover:text-iron-300 transition-colors"
          >
            Try each industry scenario in the live demo
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ════════════════ BEFORE / AFTER ════════════════ */}
      <section className="bg-gray-50 dark:bg-gray-900/40 border-y border-gray-100 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Pseudonymization</p>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">What the AI actually sees</h2>
            <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              Iron Gate replaces every sensitive entity with a format-preserving pseudonym. The AI gives a useful response — with zero real data.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {/* Before */}
            <div className="rounded-2xl border-2 border-red-200 dark:border-red-900/50 overflow-hidden">
              <div className="bg-red-50 dark:bg-red-950/30 px-5 py-3 flex items-center gap-2 border-b border-red-200 dark:border-red-900/50">
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                <span className="text-sm font-bold text-red-700 dark:text-red-400">What the employee typed</span>
              </div>
              <div className="p-5 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-mono">
                Draft a memo about the <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1 rounded font-semibold">Johnson v. Acme Corp</span> case. My client <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1 rounded font-semibold">Robert Johnson</span> (SSN: <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1 rounded font-semibold">423-55-8901</span>) is seeking <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1 rounded font-semibold">$4.2M</span> in a <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1 rounded font-semibold">privileged attorney-client communication</span>.
              </div>
            </div>

            {/* After */}
            <div className="rounded-2xl border-2 border-green-200 dark:border-green-900/50 overflow-hidden">
              <div className="bg-green-50 dark:bg-green-950/30 px-5 py-3 flex items-center gap-2 border-b border-green-200 dark:border-green-900/50">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                <span className="text-sm font-bold text-green-700 dark:text-green-400">What the AI receives</span>
              </div>
              <div className="p-5 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-mono">
                Draft a memo about the <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-semibold">Doe v. Beta Inc</span> case. My client <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-semibold">John Doe</span> (SSN: <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-semibold">***-**-****</span>) is seeking <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-semibold">$[REDACTED]</span> in a <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-semibold">confidential discussion</span>.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ SECURITY ARCHITECTURE ════════════════ */}
      <section id="security" className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-iron-600 dark:text-iron-400 mb-3">Security</p>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">Enterprise-grade security, built in</h2>
          <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            Iron Gate was designed from day one with a zero-knowledge architecture. Your data is encrypted, isolated, and protected at every layer.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              title: 'Zero-Knowledge',
              desc: 'Entity values are SHA-256 hashed client-side. Raw PII never reaches our servers. Only encrypted metadata is stored.',
              icon: '🔒',
            },
            {
              title: 'Envelope Encryption',
              desc: 'AES-256-GCM with unique per-event data keys, wrapped by firm-level KMS master keys. Keys rotate automatically.',
              icon: '🔑',
            },
            {
              title: 'Firm Isolation',
              desc: 'PostgreSQL Row-Level Security enforces data isolation at the database layer. No cross-firm data access is possible.',
              icon: '🏢',
            },
            {
              title: 'Tamper-Proof Audit',
              desc: 'Every event is hash-chained using SHA-256. Break one link and the entire chain fails verification.',
              icon: '⛓️',
            },
            {
              title: 'Kill Switch',
              desc: 'Global or per-firm emergency shutdown with dual-key authentication. Extension fails closed — protection never stops.',
              icon: '🛑',
            },
            {
              title: 'GDPR Compliance',
              desc: 'Right-to-erasure with 24h grace period. Automated data retention cleanup. Full audit trail for regulators.',
              icon: '📋',
            },
            {
              title: 'Network Hardening',
              desc: 'TLS 1.3, certificate pinning, host allowlists, security headers (HSTS, CSP), and rate limiting on every endpoint.',
              icon: '🌐',
            },
            {
              title: 'Breach Detection',
              desc: '7 real-time breach signals: volume spikes, cross-firm leaks, audit tampering, bulk extraction, and more.',
              icon: '🚨',
            },
          ].map((item) => (
            <div key={item.title} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:shadow-lg transition-all">
              <span className="text-2xl mb-4 block">{item.icon}</span>
              <h3 className="text-base font-bold mb-2">{item.title}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════ CTA ════════════════ */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="relative rounded-3xl overflow-hidden">
          {/* CTA background */}
          <div className="absolute inset-0 bg-gradient-to-br from-iron-600 via-iron-700 to-purple-700" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.1),transparent_60%)]" />

          <div className="relative px-8 py-16 md:px-16 md:py-24 text-center text-white">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-5">Start protecting your firm today</h2>
            <p className="text-iron-100/80 max-w-xl mx-auto mb-10 text-lg">
              Set up in minutes. Monitor every AI interaction. Detect sensitive data before it leaves your network. No credit card required.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/sign-up"
                className="group px-8 py-3.5 bg-white text-iron-700 font-bold rounded-xl text-base hover:bg-iron-50 transition-all shadow-xl flex items-center gap-2"
              >
                Get Started Free
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/demo"
                className="px-8 py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-base transition-all border border-white/20"
              >
                Try Live Demo
              </Link>
            </div>
          </div>
        </div>
      </section>

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
              <a href="#features" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">How It Works</a>
              <a href="#security" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Security</a>
              <a href="#industries" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Industries</a>
              <Link href="/demo" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Demo</Link>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">v0.3.0</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
