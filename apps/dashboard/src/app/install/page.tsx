'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

const EXTENSION_ZIP_URL = '/api/download-extension';

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

function ApiKeyCard({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <div className="bg-iron-50 dark:bg-iron-900/20 border-2 border-iron-300 dark:border-iron-700 rounded-2xl p-6 md:p-8 mb-16">
      <div className="flex items-start gap-3 mb-4">
        <svg className="w-6 h-6 text-iron-600 dark:text-iron-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
        </svg>
        <div>
          <h2 className="text-lg font-bold text-iron-800 dark:text-iron-200">Your API Key</h2>
          <p className="text-sm text-iron-600 dark:text-iron-400 mt-1">
            You&apos;ll paste this in Step 5 after installing the extension.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <code className="block w-full px-4 py-3 bg-white dark:bg-[#1c1c1e] rounded-lg text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] border border-iron-200 dark:border-iron-800 break-all">
            {visible ? apiKey : apiKey.substring(0, 8) + '\u2022'.repeat(Math.min(apiKey.length - 8, 20))}
          </code>
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
            aria-label={visible ? 'Hide key' : 'Show key'}
          >
            {visible ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={`min-h-[48px] px-5 py-3 rounded-lg text-sm font-semibold transition-colors flex-shrink-0 ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-iron-600 hover:bg-iron-700 text-white'
          }`}
        >
          {copied ? 'Copied!' : 'Copy Key'}
        </button>
      </div>
    </div>
  );
}

function InstallPageContent() {
  const searchParams = useSearchParams();
  const apiKey = searchParams.get('key');
  const hasKey = apiKey && apiKey.startsWith('ig_') && apiKey.length >= 20;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-[#1d1d1f] dark:text-[#f5f5f7]">
      {/* Nav */}
      <nav className="border-b border-[#d2d2d7]/30 dark:border-[#38383a]/40 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-lg">
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
            <Link href="/sign-in" className="text-sm font-medium text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
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
            Browser Extension
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Install Iron Gate
          </h1>
          <p className="text-lg text-[#6e6e73] dark:text-[#86868b] max-w-xl mx-auto">
            The browser extension monitors AI tool usage and detects sensitive data in real-time. Works with Chrome, Edge, Brave, and any Chromium-based browser. Setup takes less than 2 minutes.
          </p>
        </div>

        {/* Download button */}
        <div className="text-center mb-16">
          <a
            href={EXTENSION_ZIP_URL}
            download="iron-gate-extension-v0.2.7.zip"
            className="inline-flex items-center gap-3 px-8 py-4 bg-iron-600 hover:bg-iron-700 text-white font-bold rounded-xl text-lg transition-all shadow-xl shadow-iron-600/25 hover:shadow-2xl hover:shadow-iron-600/30"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Extension (ZIP)
          </a>
          <p className="text-sm text-[#86868b] dark:text-[#636366] mt-3">
            v0.2.7 &middot; Chrome, Edge, Brave &middot; Manifest V3
          </p>
        </div>

        {/* API Key Card — shown when ?key= is present */}
        {hasKey && <ApiKeyCard apiKey={apiKey} />}

        {/* Installation Steps */}
        <div className="bg-[#f5f5f7] dark:bg-[#141414] rounded-2xl p-8 md:p-10 border border-[#d2d2d7]/40 dark:border-[#38383a]/40 mb-16">
          <h2 className="text-xl font-bold mb-8">Installation Steps</h2>
          <ol className="space-y-8">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                1
              </span>
              <div>
                <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Download the ZIP file</p>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  Click the download button above to get the extension package.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                2
              </span>
              <div>
                <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Unzip the file</p>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  Extract the ZIP to a folder on your computer. Remember where you saved it.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                3
              </span>
              <div>
                <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Open Extensions Page</p>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  Navigate to <code className="px-1.5 py-0.5 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded text-xs font-mono">chrome://extensions</code> in Chrome, Edge, or Brave. Enable <strong>Developer mode</strong> using the toggle in the top-right corner.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                4
              </span>
              <div>
                <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Load the extension</p>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  Click <strong>&ldquo;Load unpacked&rdquo;</strong> and select the unzipped folder. The Iron Gate icon will appear in your toolbar.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-iron-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                5
              </span>
              <div>
                <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Connect to your organization</p>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  Right-click the Iron Gate toolbar icon and select <strong>&ldquo;Open side panel&rdquo;</strong>.
                  {hasKey ? (
                    <> Paste the API key shown above when prompted.</>
                  ) : (
                    <> The setup wizard will guide you through pasting your API key (starts with <code className="px-1.5 py-0.5 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded text-xs font-mono">ig_</code>). Your admin receives this key during onboarding.</>
                  )}
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
                <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">You&apos;re protected!</p>
                <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
                  Visit any supported AI tool and Iron Gate will automatically monitor for sensitive data. Open the side panel to see real-time activity.
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
                className="px-4 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg text-sm font-medium text-[#424245] dark:text-[#a1a1a6] border border-[#d2d2d7]/40 dark:border-[#38383a]/60"
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
              <p className="text-sm text-iron-700 dark:text-iron-400 leading-relaxed mb-3">
                For organization-wide deployment, use Chrome/Edge Enterprise policies to force-install the
                extension across all managed devices. This also works with Edge and Brave on managed Chromium profiles. Add the following to your policy JSON:
              </p>
              <pre className="text-xs bg-iron-100 dark:bg-iron-900/40 rounded-lg p-3 overflow-x-auto font-mono text-iron-800 dark:text-iron-200 leading-relaxed">
{`{
  "ExtensionInstallForcelist": [
    "<your-extension-id>;${EXTENSION_ZIP_URL}"
  ]
}`}
              </pre>
              <p className="text-xs text-iron-600 dark:text-iron-400 mt-2">
                Replace <code className="font-mono">&lt;your-extension-id&gt;</code> with the ID from <code className="font-mono">chrome://extensions</code>.
                This ensures all employees are protected automatically without individual installations.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <p className="text-[#6e6e73] dark:text-[#86868b] mb-4">
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

export default function InstallPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
      </div>
    }>
      <InstallPageContent />
    </Suspense>
  );
}
