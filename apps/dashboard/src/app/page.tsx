import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-iron-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">IG</span>
          </div>
          <span className="text-xl font-bold">Iron Gate</span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/demo"
            className="px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Try Live Demo
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 pt-20 pb-16 md:pt-32 md:pb-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-iron-100 dark:bg-iron-900/40 text-iron-700 dark:text-iron-300 text-xs font-medium mb-6">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Now monitoring ChatGPT, Claude, Gemini, Copilot &amp; more
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight">
            Stop sensitive data from
            <span className="text-iron-600 dark:text-iron-400"> leaking into AI tools</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
            Iron Gate monitors every prompt your employees send to AI assistants, detects confidential information in real time, and blocks it before it leaves your network.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/demo"
              className="px-6 py-3 bg-iron-600 hover:bg-iron-700 text-white font-semibold rounded-lg text-base transition-colors shadow-lg shadow-iron-600/25"
            >
              Try Live Demo
            </Link>
            <a
              href="#features"
              className="px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 font-semibold rounded-lg text-base transition-colors"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 pb-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { value: '2,847', label: 'Interactions Monitored' },
            { value: '187', label: 'Sensitive Prompts Caught' },
            { value: '43', label: 'Uploads Blocked' },
            { value: '<200ms', label: 'Detection Latency' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
              <p className="text-2xl md:text-3xl font-bold text-iron-600 dark:text-iron-400">{stat.value}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">Enterprise AI Governance</h2>
        <p className="text-center text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-16">
          A comprehensive platform that sits between your employees and every AI tool they use.
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              ),
              title: 'Real-Time Detection',
              desc: 'Scans every prompt for SSNs, client names, privileged communications, deal codenames, and 30+ entity types as they are typed.',
            },
            {
              icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ),
              title: 'Block Before Send',
              desc: 'Intercepts sensitive prompts and document uploads at the network level before they reach any LLM provider. No data leaves your perimeter.',
            },
            {
              icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                </svg>
              ),
              title: 'Executive Dashboard',
              desc: 'Full visibility into AI usage across the firm — exposure reports, trust scores, audit trails with tamper-proof blockchain integrity.',
            },
            {
              icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
              ),
              title: 'Document Scanning',
              desc: 'Intercepts PDF, DOCX, XLSX, CSV, and TXT uploads to AI tools. Scans content for sensitive data and blocks uploads that exceed risk thresholds.',
            },
            {
              icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              ),
              title: 'Proxy Mode',
              desc: 'Optional proxy mode automatically redacts sensitive entities before they reach the AI — employees keep working, data stays protected.',
            },
            {
              icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              ),
              title: 'Tamper-Proof Audit',
              desc: 'Every interaction is logged in a blockchain-style audit chain with SHA-256 hashing. Verify integrity at any time for compliance.',
            },
          ].map((f) => (
            <div key={f.title} className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800 hover:border-iron-300 dark:hover:border-iron-700 transition-colors">
              <div className="text-iron-600 dark:text-iron-400 mb-4">{f.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
        <div className="bg-iron-600 dark:bg-iron-700 rounded-2xl p-8 md:p-16 text-center text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">See it in action</h2>
          <p className="text-iron-100 dark:text-iron-200 max-w-xl mx-auto mb-8">
            Explore the live dashboard with demo data. No sign-up required to browse — all charts, reports, and features are fully interactive.
          </p>
          <Link
            href="/demo"
            className="inline-block px-8 py-3 bg-white text-iron-700 font-semibold rounded-lg text-base hover:bg-iron-50 transition-colors shadow-lg"
          >
            Try Live Demo
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 mt-8">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-iron-600 rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">IG</span>
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Iron Gate v0.2.0</span>
          </div>
          <p className="text-sm text-gray-400 dark:text-gray-500">Enterprise AI Governance Platform</p>
        </div>
      </footer>
    </div>
  );
}
