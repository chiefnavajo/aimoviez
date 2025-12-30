'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';

// ============================================================================
// SHARED ACTION BUTTON - Used in Dashboard and Story pages
// ============================================================================

export interface ActionButtonProps {
  icon: React.ReactNode;
  label?: string | number;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
}

export const ActionButton = memo(function ActionButton({
  icon,
  label,
  onClick,
  ariaLabel
}: ActionButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className="flex flex-col items-center gap-1 focus:outline-none"
      aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      type="button"
    >
      <div className="w-12 h-12 rounded-full flex items-center justify-center">
        {icon}
      </div>
      {label !== undefined && (
        <span className="text-white text-[11px] font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {label}
        </span>
      )}
    </motion.button>
  );
});

export default ActionButton;
