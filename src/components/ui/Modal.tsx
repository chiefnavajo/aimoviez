// components/ui/Modal.tsx
// Accessible modal component with focus trap, ARIA attributes, and keyboard navigation
// Compliant with WCAG 2.1 AA

'use client';

import { ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { cn } from '@/lib/utils';

interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when the modal should close */
  onClose: () => void;
  /** Modal title for accessibility */
  title: string;
  /** Optional description for accessibility */
  description?: string;
  /** Modal content */
  children: ReactNode;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** Whether clicking overlay closes modal */
  closeOnOverlayClick?: boolean;
  /** Custom class for the modal container */
  className?: string;
  /** Whether the modal has a header */
  showHeader?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[95vw] max-h-[95vh]',
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  className,
  showHeader = true,
}: ModalProps) {
  // Focus trap for accessibility
  const containerRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
    autoFocus: true,
    restoreFocus: true,
  });

  // Announce to screen readers when modal opens
  useEffect(() => {
    if (isOpen) {
      // Create live region announcement
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      announcement.className = 'sr-only';
      announcement.textContent = `${title} dialog opened`;
      document.body.appendChild(announcement);

      return () => {
        document.body.removeChild(announcement);
      };
    }
  }, [isOpen, title]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={closeOnOverlayClick ? onClose : undefined}
            aria-hidden="true"
          />

          {/* Modal Container - for centering */}
          <div
            className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto"
            onClick={closeOnOverlayClick ? onClose : undefined}
          >
            {/* Modal Content */}
            <motion.div
              ref={containerRef}
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: 'spring', duration: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
              aria-describedby={description ? 'modal-description' : undefined}
              tabIndex={-1}
              className={cn(
                'relative w-full bg-gray-900 rounded-2xl border border-white/20 shadow-2xl',
                sizeClasses[size],
                className
              )}
            >
              {/* Header */}
              {showHeader && (
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                  <div>
                    <h2
                      id="modal-title"
                      className="text-lg font-semibold text-white"
                    >
                      {title}
                    </h2>
                    {description && (
                      <p
                        id="modal-description"
                        className="text-sm text-white/60 mt-1"
                      >
                        {description}
                      </p>
                    )}
                  </div>
                  {showCloseButton && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10
                               transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                      aria-label="Close dialog"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}

              {/* Body */}
              <div className={cn('p-4', !showHeader && 'pt-6')}>
                {/* Hidden close button for header-less modals */}
                {!showHeader && showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 p-2 rounded-lg text-white/60 hover:text-white
                             hover:bg-white/10 transition-colors focus:outline-none focus:ring-2
                             focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                    aria-label="Close dialog"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
                {children}
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Screen reader only text helper
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span className="sr-only">
      {children}
    </span>
  );
}

// Accessible loading spinner
export function LoadingSpinner({
  size = 'md',
  label = 'Loading...',
}: {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const sizeMap = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
  };

  return (
    <div role="status" aria-label={label}>
      <div
        className={cn(
          'animate-spin rounded-full border-white/30 border-t-cyan-400',
          sizeMap[size]
        )}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default Modal;
