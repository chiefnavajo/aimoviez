'use client';

import { useState, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Flag, AlertTriangle, Loader2, Check } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'clip' | 'user' | 'comment';
  targetId: string;
  targetName?: string;
}

const REPORT_REASONS = [
  { id: 'inappropriate', label: 'Inappropriate Content', description: 'Nudity, violence, or offensive material' },
  { id: 'spam', label: 'Spam', description: 'Misleading or repetitive content' },
  { id: 'harassment', label: 'Harassment', description: 'Bullying, threats, or hate speech' },
  { id: 'copyright', label: 'Copyright Violation', description: 'Unauthorized use of copyrighted material' },
  { id: 'other', label: 'Other', description: 'Something else not listed above' },
];

export default function ReportModal({ isOpen, onClose, type, targetId, targetName }: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setSelectedReason('');
    setDescription('');
    setSubmitted(false);
    setError('');
    onClose();
  };

  // Accessibility: unique IDs and focus trap
  const titleId = useId();
  const descId = useId();
  const containerRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: handleClose,
    autoFocus: true,
    restoreFocus: true,
  });

  const handleSubmit = async () => {
    if (!selectedReason) {
      setError('Please select a reason for reporting');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const body: Record<string, string> = {
        reason: selectedReason,
        description,
      };

      if (type === 'clip') {
        body.clipId = targetId;
      } else if (type === 'user') {
        body.userId = targetId;
      } else if (type === 'comment') {
        body.commentId = targetId;
      }

      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit report');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    }

    setSubmitting(false);
  };

  const typeLabel = type === 'clip' ? 'Clip' : type === 'user' ? 'User' : 'Comment';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={handleClose}
          aria-hidden="true"
        >
          <motion.div
            ref={containerRef}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="bg-gray-900 rounded-2xl border border-white/20 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
          >
            {submitted ? (
              // Success State
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-400" />
                </div>
                <h2 className="text-xl font-bold mb-2">Report Submitted</h2>
                <p className="text-white/60 mb-6">
                  Thank you for helping keep our community safe. We'll review your report and take appropriate action.
                </p>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleClose}
                  className="px-6 py-3 bg-white/10 rounded-xl font-medium hover:bg-white/20 transition-colors"
                >
                  Close
                </motion.button>
              </div>
            ) : (
              // Report Form
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-red-500/20">
                      <Flag className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <h2 id={titleId} className="text-xl font-bold">Report {typeLabel}</h2>
                      {targetName && (
                        <p className="text-sm text-white/60">"{targetName}"</p>
                      )}
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={handleClose}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                    aria-label="Close report dialog"
                  >
                    <X className="w-5 h-5" />
                  </motion.button>
                </div>

                {/* Reason Selection */}
                <div className="space-y-3 mb-6" role="radiogroup" aria-labelledby={descId}>
                  <label id={descId} className="block text-sm font-medium text-white/90">
                    Why are you reporting this {type}?
                  </label>
                  {REPORT_REASONS.map((reason) => (
                    <motion.button
                      key={reason.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedReason === reason.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedReason(reason.id)}
                      className={`w-full p-4 rounded-xl border text-left transition-all focus:outline-none focus:ring-2 focus:ring-red-400 ${
                        selectedReason === reason.id
                          ? 'bg-red-500/20 border-red-500/50'
                          : 'bg-white/5 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <p className={`font-medium ${selectedReason === reason.id ? 'text-white' : 'text-white/90'}`}>
                        {reason.label}
                      </p>
                      <p className="text-sm text-white/50">{reason.description}</p>
                    </motion.button>
                  ))}
                </div>

                {/* Additional Details */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Additional details (optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             placeholder-white/40 focus:border-red-400 focus:outline-none transition-colors resize-none"
                    placeholder="Provide any additional context that might help us understand the issue..."
                  />
                  <p className="text-xs text-white/40 mt-1">{description.length}/1000</p>
                </div>

                {/* Warning */}
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl mb-6">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                    <p className="text-sm text-yellow-300">
                      False reports may result in action against your account. Please only report genuine violations.
                    </p>
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-4 bg-red-500/20 border border-red-500/40 rounded-xl mb-6">
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleClose}
                    disabled={submitting}
                    className="flex-1 py-3 rounded-xl bg-white/10 font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSubmit}
                    disabled={submitting || !selectedReason}
                    className="flex-1 py-3 rounded-xl bg-red-500 font-bold hover:bg-red-600 transition-colors
                             disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Flag className="w-5 h-5" />
                        Submit Report
                      </>
                    )}
                  </motion.button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
