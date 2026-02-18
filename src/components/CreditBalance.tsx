'use client';

// =============================================================================
// CREDIT BALANCE
// Compact credit display for the Navbar. Shows coin icon + balance.
// Clicking opens the CreditPurchaseModal.
// Only visible when credit_system feature flag is enabled.
// =============================================================================

import { useState } from 'react';
import { Coins } from 'lucide-react';
import { useCredits } from '@/hooks/useCredits';
import { useFeature } from '@/hooks/useFeatureFlags';
import CreditPurchaseModal from './CreditPurchaseModal';

export default function CreditBalance() {
  const { enabled: creditSystemEnabled, isLoading: flagLoading } = useFeature('credit_system');
  const { balance, isLoading: balanceLoading, refetch } = useCredits();
  const [modalOpen, setModalOpen] = useState(false);

  // Don't render anything if credit system is off or still loading
  if (flagLoading || !creditSystemEnabled) return null;

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/20 hover:border-yellow-500/40 transition-all duration-200"
        aria-label={`${balance} credits. Click to buy more.`}
      >
        <Coins className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-bold text-yellow-300">
          {balanceLoading ? '...' : balance}
        </span>
      </button>

      <CreditPurchaseModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          refetch();
        }}
        currentBalance={balance}
      />
    </>
  );
}
