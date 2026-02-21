import Link from 'next/link';

const EXTENSION_ZIP_URL =
  'https://github.com/ssiddharthsoni-spec/irongate2/releases/latest/download/iron-gate-extension-v0.1.0.zip';

const SUPPORTED_TOOLS = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Copilot',
  'DeepSeek',
  'Poe',
  'Perplexity',
  'You.com',
  'HuggingFace Chat',
  'Groq',
];

export default function InstallPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 dark:border-gray-800/50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg">
        <div className="flex items-center justify-between px-6 md:px-12 py-3 max-w-5xl mx-auto">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-iron-600 rounded-lg flex items-center justify-center shadow-lg shadow-iron-600/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">Iron Gate</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/sign-up" className="px-4 py-2 bg-iron-600 hover:bg-iron-700 text-white text-sm font-semibold rounded-lg transition-all shadow-md shadow-iron-600/20">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 md:px-12 py-16 md:py-24">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-iron-50 dark:bg-iron-900/30 border border-iron-200 dark:border-iron-800 text-iron-700 dark:text-iron-300 text-xs font-semibold mb-6 tracking-wide uppercase">
            Chrome Extension
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Install Iron Gate
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            The Chrome extension monitors AI tool usage and detects sensitive data in real-time. Setup takes less than 2 minutes.
          </p>
        </div>

        {/* Download button */}
        <div className="text-center mb-16">
          <a
            href={EXTENSION_ZIP_URL}
            className="inline-flex items-center gap-3 px-8 py-4 bg-iron-600 hover:bg-iron-700 text-white font-bold rounded-xl text-lg transition-all shadow-xl shadow-iron-600/25 hover:shadow-2xl hover:shadow-iron-600/30"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Extension (ZIP)
          </a>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-3">
            v0.1.0 &middot; Chrome &middot; Manifest V3
          </p>
        </div>

        {/* Installation Steps */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 mb-16">
          <h2 className="text-xl font-bold mb-8">Installation Steps</h2>
          <ol className="space-y-8">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                1
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Download the ZIP file</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Click the download button above to get the extension package.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                2
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Unzip the file</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Extract the ZIP to a folder on your computer. Remember where you saved it.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                3
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Open Chrome Extensions</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Navigate to <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">chrome://extensions</code> in your browser. Enable <strong>Developer mode</strong> using the toggle in the top-right corner.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                4
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Load the extension</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Click <strong>&ldquo;Load unpacked&rdquo;</strong> and select the unzipped folder. The Iron Gate icon will appear in your toolbar.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">You&apos;re protected!</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Visit any supported AI tool and Iron Gate will automatically monitor for sensitive data. Open the side panel to see activity.
                </p>
              </div>
            </li>
          </ol>
        </div>

        {/* Supported Tools */}
        <div className="mb-16">
          <h2 className="text-xl font-bold mb-6 text-center">Supported AI Tools</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {SUPPORTED_TOOLS.map((tool) => (
              <span
                key={tool}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>

        {/* Enterprise */}
        <div className="bg-iron-50 dark:bg-iron-900/20 rounded-2xl p-8 border border-iron-200 dark:border-iron-800">
          <div className="flex gap-4">
            <svg className="w-6 h-6 text-iron-600 dark:text-iron-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
            </svg>
            <div>
              <p className="font-bold text-iron-800 dark:text-iron-300 mb-2">Enterprise Deployment</p>
              <p className="text-sm text-iron-700 dark:text-iron-400 leading-relaxed">
                For organization-wide deployment, use Chrome Enterprise policies to force-install the
                extension across all managed devices. Use the <span className="font-medium">ExtensionInstallForcelist</span> policy
                in the Google Chrome Enterprise documentation. This ensures all employees are protected
                automatically without individual installations.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Don&apos;t have an Iron Gate account yet?
          </p>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 px-6 py-3 bg-iron-600 hover:bg-iron-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-iron-600/20"
          >
            Create Free Account
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
