import React from 'react';

interface TrustPageProps {
  onClose: () => void;
}

/**
 * Trust & transparency page — explains exactly what Iron Gate can and cannot see.
 * Accessible from settings in the side panel.
 */
export function TrustPage({ onClose }: TrustPageProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900">Trust & Transparency</h1>
      </div>

      <div className="space-y-4">
        {/* What we can see */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-gray-900">What we can see</h2>
          </div>
          <ul className="space-y-1.5 ml-8">
            <li className="text-xs text-gray-600">Text you type into supported AI tools (ChatGPT, Claude, Gemini, etc.)</li>
            <li className="text-xs text-gray-600">Files you upload to AI tools through the browser</li>
            <li className="text-xs text-gray-600">Which AI tool you're using and when</li>
          </ul>
        </div>

        {/* What we never see */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-gray-900">What we never see</h2>
          </div>
          <ul className="space-y-1.5 ml-8">
            <li className="text-xs text-gray-600">Your passwords or login credentials</li>
            <li className="text-xs text-gray-600">Your browsing history or other tabs</li>
            <li className="text-xs text-gray-600">Files on your computer (only browser uploads)</li>
            <li className="text-xs text-gray-600">Your screen or webcam</li>
            <li className="text-xs text-gray-600">Non-AI websites you visit</li>
          </ul>
        </div>

        {/* What we send */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m-6 3.75 3 3m0 0 3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25H9" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-gray-900">What we send to our server</h2>
          </div>
          <ul className="space-y-1.5 ml-8">
            <li className="text-xs text-gray-600">SHA-256 hashes of detected entities (not the raw text)</li>
            <li className="text-xs text-gray-600">Sensitivity scores and entity types</li>
            <li className="text-xs text-gray-600">Prompt length and capture method</li>
            <li className="text-xs text-gray-600 font-semibold">We never send your actual prompt text to our servers</li>
          </ul>
        </div>

        {/* What you control */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-iron-100 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-iron-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-gray-900">What you control</h2>
          </div>
          <ul className="space-y-1.5 ml-8">
            <li className="text-xs text-gray-600">Disable or uninstall the extension at any time</li>
            <li className="text-xs text-gray-600">Switch between Audit and Proxy modes</li>
            <li className="text-xs text-gray-600">Export your compliance data</li>
            <li className="text-xs text-gray-600">Request deletion of your account and data</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
