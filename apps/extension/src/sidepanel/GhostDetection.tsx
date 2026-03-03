import React from 'react';

interface GhostDetectionProps {
  entityType: string;
  confidence: number;
}

/**
 * Ghost detection card — dimmed card showing what Pro would have caught.
 * Shown to Basic tier users to encourage upgrade.
 */
export function GhostDetection({ entityType, confidence }: GhostDetectionProps) {
  return (
    <div className="relative px-4 py-2 opacity-60">
      <div className="flex items-center justify-between bg-gray-50 rounded-lg p-2.5 border border-dashed border-gray-300">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500">
              Pro would have caught: <span className="font-semibold text-gray-600">{entityType}</span>
            </p>
            <p className="text-[9px] text-gray-400">
              {Math.round(confidence * 100)}% confidence
            </p>
          </div>
        </div>
        <button
          onClick={() => chrome.tabs.create({ url: 'https://irongate-dashboard.vercel.app/settings/billing' })}
          className="text-[10px] font-semibold text-iron-600 hover:text-iron-700 flex-shrink-0 px-2 py-1 rounded hover:bg-iron-50 transition-colors"
        >
          Upgrade
        </button>
      </div>
    </div>
  );
}
