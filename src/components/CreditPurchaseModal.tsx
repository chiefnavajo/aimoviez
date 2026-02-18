'use client';

// =============================================================================
// CREDIT PURCHASE MODAL
// Displays available credit packages with pricing, bonus percentages, and
// a "Most Popular" / "Best Value" highlight. Redirects to Stripe Checkout.
// =============================================================================

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Coins, Sparkles, Loader2, Zap, Crown } from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  total_credits: number;
  price_cents: number;
  price_per_credit_cents: number;
}

interface ModelPricing {
  model_key: string;
  display_name: string;
  credit_cost: number;
}

interface CreditPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
}

// Package highlight labels
const PACKAGE_LABELS: Record<string, { label: string; color: string }> = {
  'Popular': { label: 'MOST POPULAR', color: 'from-purple-500 to-pink-500' },
  'Studio': { label: 'BEST VALUE', color: 'from-cyan-500 to-blue-500' },
};

// Package icons
const PACKAGE_ICONS: Record<string, typeof Coins> = {
  'Try It': Zap,
  'Starter': Coins,
  'Popular': Sparkles,
  'Pro': Crown,
  'Studio': Crown,
};

export default function CreditPurchaseModal({
  isOpen,
  onClose,
  currentBalance,
}: CreditPurchaseModalProps) {
  const { post: csrfPost, ensureToken } = useCsrf();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [purchaseLoading, setPurchaseLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch packages when modal opens
  useEffect(() => {
    if (!isOpen) return;

    async function fetchPackages() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/credits/packages', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setPackages(data.packages || []);
          setModelPricing(data.model_pricing || []);
        }
      } catch {
        setError('Failed to load packages');
      } finally {
        setIsLoading(false);
      }
    }

    fetchPackages();
  }, [isOpen]);

  const handlePurchase = async (packageId: string) => {
    setPurchaseLoading(packageId);
    setError(null);

    try {
      await ensureToken();

      const result = await csrfPost<{
        success: boolean;
        checkoutUrl?: string;
        error?: string;
      }>('/api/credits/purchase', { packageId });

      if (!result.success || !result.checkoutUrl) {
        throw new Error(result.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
      setPurchaseLoading(null);
    }
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0a0a18] border border-white/10 shadow-2xl"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[#0a0a18] border-b border-white/10 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Get Credits</h2>
                <p className="text-sm text-white/50 mt-0.5">
                  Current balance: <span className="text-yellow-400 font-medium">{currentBalance}</span> credits
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Loading */}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Package grid */}
              {!isLoading && packages.length > 0 && (
                <div className="space-y-3">
                  {packages.map((pkg) => {
                    const highlight = PACKAGE_LABELS[pkg.name];
                    const Icon = PACKAGE_ICONS[pkg.name] || Coins;
                    const isPopular = pkg.name === 'Popular';

                    return (
                      <button
                        key={pkg.id}
                        onClick={() => handlePurchase(pkg.id)}
                        disabled={!!purchaseLoading}
                        className={`w-full relative p-4 rounded-xl border transition-all text-left ${
                          isPopular
                            ? 'bg-purple-500/10 border-purple-500/40 hover:border-purple-500/60'
                            : 'bg-white/5 border-white/10 hover:border-white/20'
                        } ${purchaseLoading === pkg.id ? 'opacity-70' : ''}`}
                      >
                        {/* Highlight badge */}
                        {highlight && (
                          <div className={`absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full bg-gradient-to-r ${highlight.color} text-[10px] font-bold tracking-wider text-white`}>
                            {highlight.label}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                              isPopular
                                ? 'bg-purple-500/20'
                                : 'bg-white/5'
                            }`}>
                              <Icon className={`w-5 h-5 ${
                                isPopular ? 'text-purple-400' : 'text-yellow-400'
                              }`} />
                            </div>
                            <div>
                              <p className="font-bold text-white">{pkg.name}</p>
                              <span className="text-sm text-yellow-300 font-medium">
                                {pkg.credits} credits
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-lg font-bold text-white">
                              {formatPrice(pkg.price_cents)}
                            </p>
                            {purchaseLoading === pkg.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-purple-400 ml-auto" />
                            ) : (
                              <p className="text-xs text-white/40">
                                {formatPrice(pkg.price_per_credit_cents)}/credit
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Model pricing reference */}
              {!isLoading && modelPricing.length > 0 && (
                <div className="pt-2 border-t border-white/5">
                  <p className="text-xs text-white/40 mb-2">Credits per generation:</p>
                  <div className="flex flex-wrap gap-2">
                    {modelPricing.map((mp) => (
                      <div
                        key={mp.model_key}
                        className="px-2.5 py-1 bg-white/5 rounded-lg text-xs text-white/50"
                      >
                        {mp.display_name}: <span className="text-yellow-300 font-medium">{mp.credit_cost}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
