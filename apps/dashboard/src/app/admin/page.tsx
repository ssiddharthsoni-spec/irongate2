'use client';

import React, { useState } from 'react';

export default function AdminPage() {
  const [mode, setMode] = useState<'audit' | 'proxy'>('audit');
  const [thresholds, setThresholds] = useState({ warn: 40, block: 70, proxy: 50 });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Admin Settings</h1>

      {/* Mode Selection */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Operation Mode</h2>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setMode('audit')}
            className={`p-4 rounded-lg border-2 text-left ${
              mode === 'audit' ? 'border-iron-500 bg-iron-50' : 'border-gray-200'
            }`}
          >
            <p className="font-medium">Audit Mode</p>
            <p className="text-sm text-gray-500 mt-1">Monitor only. No interference with AI tool usage.</p>
          </button>
          <button
            onClick={() => setMode('proxy')}
            className={`p-4 rounded-lg border-2 text-left ${
              mode === 'proxy' ? 'border-iron-500 bg-iron-50' : 'border-gray-200'
            }`}
          >
            <p className="font-medium">Proxy Mode</p>
            <p className="text-sm text-gray-500 mt-1">Intercept and protect sensitive prompts automatically.</p>
          </button>
        </div>
      </div>

      {/* Thresholds */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sensitivity Thresholds</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Warn Threshold: {thresholds.warn}</label>
            <input
              type="range" min="0" max="100"
              value={thresholds.warn}
              onChange={(e) => setThresholds({ ...thresholds, warn: parseInt(e.target.value) })}
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Block Threshold: {thresholds.block}</label>
            <input
              type="range" min="0" max="100"
              value={thresholds.block}
              onChange={(e) => setThresholds({ ...thresholds, block: parseInt(e.target.value) })}
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Proxy Threshold: {thresholds.proxy}</label>
            <input
              type="range" min="0" max="100"
              value={thresholds.proxy}
              onChange={(e) => setThresholds({ ...thresholds, proxy: parseInt(e.target.value) })}
              className="w-full mt-1"
            />
          </div>
        </div>
        <button className="mt-4 px-4 py-2 bg-iron-600 text-white rounded-lg text-sm hover:bg-iron-700">
          Save Thresholds
        </button>
      </div>

      {/* Client/Matter Import */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Client/Matter Data</h2>
        <p className="text-sm text-gray-500 mb-4">
          Import client and matter data to enhance detection accuracy.
          Upload a CSV with columns: clientName, matterNumber, aliases, parties.
        </p>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-400">Drag and drop CSV file here, or click to browse</p>
          <input type="file" accept=".csv" className="hidden" />
          <button className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
            Browse Files
          </button>
        </div>
      </div>
    </div>
  );
}
