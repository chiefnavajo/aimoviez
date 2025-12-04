'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, Loader2, Check } from 'lucide-react';
import {
  isPushSupported,
  getNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  showLocalNotification,
} from '@/lib/push-notifications';

interface NotificationSettingsProps {
  compact?: boolean;
}

export default function NotificationSettings({ compact = false }: NotificationSettingsProps) {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      const supported = isPushSupported();
      setIsSupported(supported);

      if (supported) {
        setPermission(getNotificationPermission());

        // Check if already subscribed
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
        } catch {
          setIsSubscribed(false);
        }
      }
    };

    checkStatus();
  }, []);

  const handleToggle = async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      if (isSubscribed) {
        // Unsubscribe
        const success = await unsubscribeFromPush();
        if (success) {
          setIsSubscribed(false);
          setPermission(getNotificationPermission());
        }
      } else {
        // Subscribe
        const subscription = await subscribeToPush();
        if (subscription) {
          setIsSubscribed(true);
          setPermission('granted');
          setShowSuccess(true);

          // Show test notification
          await showLocalNotification('Notifications Enabled!', {
            body: 'You\'ll now receive updates about voting, winners, and more.',
            tag: 'welcome-notification',
          });

          setTimeout(() => setShowSuccess(false), 2000);
        } else {
          setPermission(getNotificationPermission());
        }
      }
    } catch (error) {
      console.error('[NotificationSettings] Toggle error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isSupported) {
    if (compact) return null;

    return (
      <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
        <BellOff className="w-5 h-5 text-white/60" />
        <span className="text-white/60 text-sm">Notifications not supported</span>
      </div>
    );
  }

  if (compact) {
    return (
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={handleToggle}
        disabled={isLoading || permission === 'denied'}
        className={`relative p-2.5 rounded-full transition-colors ${
          isSubscribed
            ? 'bg-cyan-500/20 text-cyan-400'
            : permission === 'denied'
            ? 'bg-white/5 text-white/60 cursor-not-allowed'
            : 'bg-white/10 text-white/70 hover:bg-white/15'
        }`}
        title={
          permission === 'denied'
            ? 'Notifications blocked in browser settings'
            : isSubscribed
            ? 'Disable notifications'
            : 'Enable notifications'
        }
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isSubscribed ? (
          <Bell className="w-5 h-5" />
        ) : (
          <BellOff className="w-5 h-5" />
        )}

        <AnimatePresence>
          {showSuccess && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center"
            >
              <Check className="w-3 h-3 text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    );
  }

  return (
    <div className="p-4 bg-white/5 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isSubscribed ? 'bg-cyan-500/20' : 'bg-white/10'
            }`}
          >
            {isSubscribed ? (
              <Bell className="w-5 h-5 text-cyan-400" />
            ) : (
              <BellOff className="w-5 h-5 text-white/50" />
            )}
          </div>
          <div>
            <h3 className="text-white font-medium">Push Notifications</h3>
            <p className="text-white/50 text-sm">
              {permission === 'denied'
                ? 'Blocked in browser settings'
                : isSubscribed
                ? 'Receiving updates'
                : 'Get notified about voting & winners'}
            </p>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleToggle}
          disabled={isLoading || permission === 'denied'}
          className={`relative px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            isSubscribed
              ? 'bg-white/10 text-white hover:bg-white/15'
              : permission === 'denied'
              ? 'bg-white/5 text-white/60 cursor-not-allowed'
              : 'bg-cyan-500 text-white hover:bg-cyan-600'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isSubscribed ? (
            'Disable'
          ) : permission === 'denied' ? (
            'Blocked'
          ) : (
            'Enable'
          )}
        </motion.button>
      </div>

      {permission === 'denied' && (
        <p className="mt-3 text-amber-400/80 text-xs">
          To enable notifications, update your browser settings and reload the page.
        </p>
      )}
    </div>
  );
}
