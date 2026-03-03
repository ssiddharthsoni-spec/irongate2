/**
 * Trial notification system.
 * Registers a twice-daily alarm that checks trial status and sends
 * contextual desktop notifications at key milestones.
 */

import {
  TRIAL_START_DATE,
  TRIAL_ENDS_AT,
  SUBSCRIPTION_TIER,
  SUBSCRIPTION_CACHED_AT,
  TOTAL_ENTITIES_DETECTED,
  LAST_NOTIFICATION_DAY,
  WEEKLY_SCAN_COUNT,
} from '../shared/storage-keys';

const TRIAL_CHECK_ALARM = 'trial-check';
const WEEKLY_REMINDER_ALARM = 'weekly-reminder';

interface NotificationConfig {
  day: number;
  title: string;
  message: (stats: { entities: number }) => string;
}

const TRIAL_NOTIFICATIONS: NotificationConfig[] = [
  {
    day: 1,
    title: 'Welcome to Iron Gate!',
    message: () => 'Iron Gate is now protecting your AI conversations. Open ChatGPT or Claude to see it in action.',
  },
  {
    day: 3,
    title: 'Your first week with Iron Gate',
    message: ({ entities }) => `${entities} entities detected so far. Iron Gate is scanning every prompt you send.`,
  },
  {
    day: 5,
    title: 'Try Proxy Mode',
    message: () => 'Automatically mask sensitive data before it reaches the AI. Switch to Proxy mode in the side panel settings.',
  },
  {
    day: 7,
    title: 'Mid-trial report',
    message: ({ entities }) => `You've protected ${entities} sensitive entities across your AI tools. Keep going!`,
  },
  {
    day: 10,
    title: '5 days left in your Pro trial',
    message: () => 'Upgrade to Pro to keep ML-powered detection and proxy mode.',
  },
  {
    day: 12,
    title: '3 days left — export your data',
    message: () => 'Export your compliance data before your trial ends. Upgrade to keep all Pro features.',
  },
  {
    day: 14,
    title: 'Last day of your Pro trial',
    message: () => 'Your trial ends tomorrow. Upgrade now to avoid losing ML-powered detection.',
  },
];

/**
 * Initialize trial alarm system. Call this from the service worker startup.
 * Checks for existing alarms to avoid duplicates on service worker restart.
 */
export async function initTrialAlarms() {
  const existingTrial = await chrome.alarms.get(TRIAL_CHECK_ALARM);
  if (!existingTrial) {
    chrome.alarms.create(TRIAL_CHECK_ALARM, { periodInMinutes: 60 * 12 });
  }

  const existingWeekly = await chrome.alarms.get(WEEKLY_REMINDER_ALARM);
  if (!existingWeekly) {
    chrome.alarms.create(WEEKLY_REMINDER_ALARM, { periodInMinutes: 60 * 24 * 7 });
  }
}

/**
 * Handle alarm events. Call this from the service worker's alarm listener.
 */
export async function handleTrialAlarm(alarmName: string) {
  if (alarmName === TRIAL_CHECK_ALARM) {
    await checkTrialAndNotify();
  } else if (alarmName === WEEKLY_REMINDER_ALARM) {
    await sendWeeklyReminder();
  }
}

async function checkTrialAndNotify() {
  const data = await chrome.storage.local.get([
    TRIAL_START_DATE,
    TRIAL_ENDS_AT,
    SUBSCRIPTION_TIER,
    TOTAL_ENTITIES_DETECTED,
    LAST_NOTIFICATION_DAY,
  ]);

  const trialStart = data[TRIAL_START_DATE];
  const trialEndsAt = data[TRIAL_ENDS_AT];
  if (!trialStart) return;

  // Calculate trial day
  const startMs = new Date(trialStart).getTime();
  const dayNumber = Math.floor((Date.now() - startMs) / (1000 * 60 * 60 * 24)) + 1;
  const lastNotifiedDay = data[LAST_NOTIFICATION_DAY] || 0;

  // Check if trial has expired — auto-downgrade
  if (trialEndsAt) {
    const endMs = new Date(trialEndsAt).getTime();
    if (Date.now() > endMs && data[SUBSCRIPTION_TIER] !== 'basic') {
      await chrome.storage.local.set({
        [SUBSCRIPTION_TIER]: 'basic',
        [SUBSCRIPTION_CACHED_AT]: Date.now(),
      });
    }
  }

  // Find matching notification for today
  const entities = data[TOTAL_ENTITIES_DETECTED] || 0;
  const notification = TRIAL_NOTIFICATIONS.find(n => n.day === dayNumber);

  if (notification && dayNumber > lastNotifiedDay) {
    try {
      chrome.notifications.create(`trial-day-${dayNumber}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
        title: notification.title,
        message: notification.message({ entities }),
        priority: dayNumber >= 10 ? 2 : 1,
      });
    } catch {
      // Notifications permission may not be granted
    }

    await chrome.storage.local.set({ [LAST_NOTIFICATION_DAY]: dayNumber });
  }
}

async function sendWeeklyReminder() {
  const data = await chrome.storage.local.get([
    SUBSCRIPTION_TIER,
    WEEKLY_SCAN_COUNT,
    TOTAL_ENTITIES_DETECTED,
  ]);

  const tier = data[SUBSCRIPTION_TIER] || 'basic';
  const scans = data[WEEKLY_SCAN_COUNT] || 0;
  const entities = data[TOTAL_ENTITIES_DETECTED] || 0;

  // Only send weekly reminder to Basic tier users (post-trial)
  if (tier === 'basic' && scans > 0) {
    try {
      chrome.notifications.create('weekly-reminder', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
        title: 'Weekly AI risk summary',
        message: `${scans} prompts scanned, ${entities} entities detected. Upgrade to Pro for ML-powered detection.`,
        priority: 1,
      });
    } catch {
      // Notifications permission may not be granted
    }
  }

  // Reset weekly count
  await chrome.storage.local.set({ [WEEKLY_SCAN_COUNT]: 0 });
}
