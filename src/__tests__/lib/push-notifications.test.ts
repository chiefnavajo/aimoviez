/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// push-notifications.ts is a CLIENT-SIDE module that depends on browser
// globals (window, navigator, Notification, PushManager).
//
// IMPORTANT: jest.mock() calls are hoisted above ALL other code by Jest.
// ES module imports are also hoisted. To ensure env vars and globals are
// set BEFORE the module loads, we use a jest.mock() factory to set them
// (since factories run lazily when the module is first required, but
// jest.mock registrations happen before any imports).
// ---------------------------------------------------------------------------

/* eslint-disable no-var */
var mockGetSubscription: jest.Mock;
var mockSubscribe: jest.Mock;
var mockUnsubscribe: jest.Mock;
var mockShowNotification: jest.Mock;
var mockFetch: jest.Mock;
/* eslint-enable no-var */

// Use a jest.mock with __esModule to intercept the push-notifications module
// and set up globals before it evaluates. Since this factory runs BEFORE
// the actual module code, we set up window/navigator/Notification here.
jest.mock('@/lib/push-notifications', () => {
  // Initialize mock fns here to avoid TDZ
  mockGetSubscription = jest.fn();
  mockSubscribe = jest.fn();
  mockUnsubscribe = jest.fn();
  mockShowNotification = jest.fn().mockResolvedValue(undefined);
  mockFetch = jest.fn().mockResolvedValue({ ok: true });

  // Set env var
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkGs-GDq6QAKcQtgPPPuE-miTOuDnfpzlRlEg0yb4I';

  // Set up browser globals
  const NotificationObj: Record<string, unknown> = {
    permission: 'default',
    requestPermission: jest.fn().mockResolvedValue('granted'),
  };

  function makeMockRegistration() {
    return {
      pushManager: {
        getSubscription: mockGetSubscription,
        subscribe: mockSubscribe,
      },
      showNotification: mockShowNotification,
    };
  }

  (global as Record<string, unknown>).window = {
    atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    PushManager: class PushManager {},
    Notification: NotificationObj,
  };

  (global as Record<string, unknown>).navigator = {
    serviceWorker: { ready: Promise.resolve(makeMockRegistration()) },
  };

  (global as Record<string, unknown>).Notification = NotificationObj;
  (global as Record<string, unknown>).PushManager = class PushManager {};
  (global as Record<string, unknown>).fetch = mockFetch;

  // Now require the actual module
  return jest.requireActual('@/lib/push-notifications');
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  isPushSupported,
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  showLocalNotification,
} from '@/lib/push-notifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNotificationObj(): Record<string, unknown> {
  return global.Notification as unknown as Record<string, unknown>;
}

function resetNavigator() {
  const reg = {
    pushManager: {
      getSubscription: mockGetSubscription,
      subscribe: mockSubscribe,
    },
    showNotification: mockShowNotification,
  };
  (global as Record<string, unknown>).navigator = {
    serviceWorker: { ready: Promise.resolve(reg) },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  getNotificationObj().permission = 'default';
  getNotificationObj().requestPermission = jest.fn().mockResolvedValue('granted');
  mockGetSubscription.mockResolvedValue(null);
  mockSubscribe.mockReset();
  mockFetch.mockResolvedValue({ ok: true });
  resetNavigator();
});

describe('push-notifications', () => {
  // -----------------------------------------------------------------------
  // isPushSupported
  // -----------------------------------------------------------------------

  describe('isPushSupported', () => {
    it('returns true when all browser APIs are available', () => {
      expect(isPushSupported()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getNotificationPermission
  // -----------------------------------------------------------------------

  describe('getNotificationPermission', () => {
    it('returns granted', () => {
      getNotificationObj().permission = 'granted';
      expect(getNotificationPermission()).toBe('granted');
    });

    it('returns denied', () => {
      getNotificationObj().permission = 'denied';
      expect(getNotificationPermission()).toBe('denied');
    });

    it('returns default', () => {
      getNotificationObj().permission = 'default';
      expect(getNotificationPermission()).toBe('default');
    });
  });

  // -----------------------------------------------------------------------
  // requestNotificationPermission
  // -----------------------------------------------------------------------

  describe('requestNotificationPermission', () => {
    it('returns granted when user accepts', async () => {
      (getNotificationObj().requestPermission as jest.Mock).mockResolvedValueOnce('granted');

      const result = await requestNotificationPermission();
      expect(result).toBe('granted');
    });

    it('returns denied when user denies', async () => {
      (getNotificationObj().requestPermission as jest.Mock).mockResolvedValueOnce('denied');

      const result = await requestNotificationPermission();
      expect(result).toBe('denied');
    });

    it('returns denied when requestPermission throws', async () => {
      (getNotificationObj().requestPermission as jest.Mock).mockRejectedValueOnce(new Error('cancelled'));

      const result = await requestNotificationPermission();
      expect(result).toBe('denied');
    });
  });

  // -----------------------------------------------------------------------
  // subscribeToPush
  // -----------------------------------------------------------------------

  describe('subscribeToPush', () => {
    it('returns null when permission is not granted', async () => {
      (getNotificationObj().requestPermission as jest.Mock).mockResolvedValueOnce('denied');

      const result = await subscribeToPush();
      expect(result).toBeNull();
    });

    it('returns existing subscription if present', async () => {
      const existingSub = {
        endpoint: 'https://push.example.com/sub/123',
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/123' }),
      };
      (getNotificationObj().requestPermission as jest.Mock).mockResolvedValueOnce('granted');
      mockGetSubscription.mockResolvedValueOnce(existingSub);

      const result = await subscribeToPush();

      expect(result).toBe(existingSub);
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('creates new subscription and sends to server when none exists', async () => {
      const newSub = {
        endpoint: 'https://push.example.com/sub/456',
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/456' }),
      };
      (getNotificationObj().requestPermission as jest.Mock).mockResolvedValueOnce('granted');
      mockGetSubscription.mockResolvedValueOnce(null);
      mockSubscribe.mockResolvedValueOnce(newSub);

      const result = await subscribeToPush();

      expect(result).toBe(newSub);
      expect(mockSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ userVisibleOnly: true }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/notifications/subscribe',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns null when subscription fails', async () => {
      (getNotificationObj().requestPermission as jest.Mock).mockResolvedValueOnce('granted');
      mockGetSubscription.mockResolvedValueOnce(null);
      mockSubscribe.mockRejectedValueOnce(new Error('Subscribe failed'));

      const result = await subscribeToPush();
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // unsubscribeFromPush
  // -----------------------------------------------------------------------

  describe('unsubscribeFromPush', () => {
    it('unsubscribes and notifies server', async () => {
      const sub = {
        endpoint: 'https://push.example.com/sub/1',
        unsubscribe: mockUnsubscribe.mockResolvedValueOnce(true),
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/1' }),
      };
      mockGetSubscription.mockResolvedValueOnce(sub);

      const result = await unsubscribeFromPush();

      expect(result).toBe(true);
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/notifications/unsubscribe',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns false when no subscription exists', async () => {
      mockGetSubscription.mockResolvedValueOnce(null);

      const result = await unsubscribeFromPush();
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockGetSubscription.mockRejectedValueOnce(new Error('SW error'));

      const result = await unsubscribeFromPush();
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // showLocalNotification
  // -----------------------------------------------------------------------

  describe('showLocalNotification', () => {
    it('shows notification when permission is granted', async () => {
      getNotificationObj().permission = 'granted';

      await showLocalNotification('Hello!', { body: 'World' });

      expect(mockShowNotification).toHaveBeenCalledWith(
        'Hello!',
        expect.objectContaining({
          body: 'World',
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-96x96.png',
        }),
      );
    });

    it('does not show notification when permission is denied', async () => {
      getNotificationObj().permission = 'denied';

      await showLocalNotification('Hello!');
      expect(mockShowNotification).not.toHaveBeenCalled();
    });

    it('includes default vibrate pattern', async () => {
      getNotificationObj().permission = 'granted';

      await showLocalNotification('Test');

      expect(mockShowNotification).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({
          vibrate: [100, 50, 100],
        }),
      );
    });
  });
});
