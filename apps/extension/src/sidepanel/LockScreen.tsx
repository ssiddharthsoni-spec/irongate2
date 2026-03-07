import React, { useState, useCallback, useRef } from 'react';

interface LockScreenProps {
  onUnlock: () => void;
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000; // 2s, 4s, 8s, 16s, 32s

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);
  const attemptsRef = useRef(0);
  const lockoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUnlock = useCallback(async () => {
    if (!pin.trim() || checking || lockedOut) return;

    setChecking(true);
    setError(null);

    try {
      // Send API key to service worker for server-side verification
      const resp = await chrome.runtime.sendMessage({
        type: 'UNLOCK_SESSION',
        payload: { apiKey: pin.trim() },
      });

      if (resp?.ok) {
        attemptsRef.current = 0;
        onUnlock();
      } else {
        attemptsRef.current += 1;
        const remaining = MAX_ATTEMPTS - attemptsRef.current;

        if (remaining <= 0) {
          // Exponential backoff lockout
          const backoffMs = BASE_BACKOFF_MS * Math.pow(2, Math.min(attemptsRef.current - MAX_ATTEMPTS, 5));
          setLockedOut(true);
          setError(`Too many attempts. Try again in ${Math.ceil(backoffMs / 1000)}s.`);
          lockoutTimerRef.current = setTimeout(() => {
            setLockedOut(false);
            setError(null);
            attemptsRef.current = Math.max(0, attemptsRef.current - 2); // Partially reset
          }, backoffMs);
        } else {
          setError(`Incorrect API key (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)`);
        }
      }
    } catch {
      setError('Failed to verify');
    }

    setChecking(false);
  }, [pin, onUnlock, checking, lockedOut]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-14 h-14 bg-iron-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-iron-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </div>

      <h1 className="text-lg font-bold text-gray-900 mb-1">Session Locked</h1>
      <p className="text-xs text-gray-500 mb-6 text-center max-w-[220px]">
        Enter your API key to unlock Iron Gate
      </p>

      <input
        type="password"
        value={pin}
        onChange={(e) => { setPin(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
        placeholder="ig_xxxxxxxxxxxx..."
        className="w-full max-w-[260px] px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-transparent font-mono mb-3"
        autoFocus
        disabled={lockedOut}
      />

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      <button
        onClick={handleUnlock}
        disabled={checking || !pin.trim() || lockedOut}
        className="w-full max-w-[260px] py-2.5 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 disabled:opacity-50 transition-colors"
      >
        {checking ? 'Verifying...' : lockedOut ? 'Locked Out' : 'Unlock'}
      </button>

      <p className="text-[10px] text-gray-400 mt-4 text-center">
        Protection is still active while locked
      </p>
    </div>
  );
}
