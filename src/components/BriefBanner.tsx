'use client';

// ============================================================================
// BriefBanner - Display creative brief on /create page
// Shows scene description, visual requirements, and example prompts
// ============================================================================

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Eye,
  Palette,
  MessageSquare,
  Copy,
  Check,
} from 'lucide-react';
import { useBrief } from '@/hooks/useCoDirector';

interface BriefBannerProps {
  onSelectPrompt?: (prompt: string) => void;
}

export default function BriefBanner({ onSelectPrompt }: BriefBannerProps) {
  const { data, isLoading } = useBrief();
  const [expanded, setExpanded] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Don't render if no brief or feature disabled
  if (isLoading || !data?.has_brief || !data?.brief) {
    return null;
  }

  const brief = data.brief;

  const handleCopyPrompt = (prompt: string, index: number) => {
    navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleUsePrompt = (prompt: string) => {
    if (onSelectPrompt) {
      onSelectPrompt(prompt);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-gradient-to-r from-purple-900/30 via-blue-900/30 to-purple-900/30 border border-purple-500/30 rounded-xl overflow-hidden"
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-purple-300">Creative Brief</span>
              <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded">
                Slot {data.slot_position}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-white">{brief.title}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2 text-gray-400">
          <span className="text-sm hidden sm:inline">
            {expanded ? 'Hide details' : 'View brief'}
          </span>
          {expanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </div>
      </button>

      {/* Expandable Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Scene Description */}
              <div className="bg-black/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-300 mb-2">
                  <Eye className="w-4 h-4" />
                  <span className="text-sm font-medium">Scene Description</span>
                </div>
                <p className="text-gray-200">{brief.scene_description}</p>
              </div>

              {/* Visual Requirements & Tone */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-black/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-gray-300 mb-2">
                    <Palette className="w-4 h-4" />
                    <span className="text-sm font-medium">Visual Requirements</span>
                  </div>
                  <p className="text-sm text-gray-300">{brief.visual_requirements}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-gray-300 mb-2">
                    <MessageSquare className="w-4 h-4" />
                    <span className="text-sm font-medium">Tone</span>
                  </div>
                  <p className="text-sm text-gray-300">{brief.tone_guidance}</p>
                </div>
              </div>

              {/* Do/Don't Lists */}
              {(brief.do_list || brief.dont_list) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {brief.do_list && (
                    <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-4">
                      <span className="text-sm font-medium text-green-400">Do include:</span>
                      <p className="text-sm text-gray-300 mt-1">{brief.do_list}</p>
                    </div>
                  )}
                  {brief.dont_list && (
                    <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-4">
                      <span className="text-sm font-medium text-red-400">Avoid:</span>
                      <p className="text-sm text-gray-300 mt-1">{brief.dont_list}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Example Prompts */}
              {brief.example_prompts && brief.example_prompts.length > 0 && (
                <div className="bg-black/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-gray-300 mb-3">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm font-medium">Example Prompts</span>
                  </div>
                  <div className="space-y-2">
                    {brief.example_prompts.map((prompt, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-2 bg-gray-800/50 rounded-lg p-3 group"
                      >
                        <p className="flex-1 text-sm text-gray-200">&ldquo;{prompt}&rdquo;</p>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleCopyPrompt(prompt, index)}
                            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                            title="Copy prompt"
                          >
                            {copiedIndex === index ? (
                              <Check className="w-4 h-4 text-green-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          {onSelectPrompt && (
                            <button
                              onClick={() => handleUsePrompt(prompt)}
                              className="px-2 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium"
                            >
                              Use
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Continuity Notes */}
              {brief.continuity_notes && (
                <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-4">
                  <span className="text-sm font-medium text-yellow-400">Continuity Notes:</span>
                  <p className="text-sm text-gray-300 mt-1">{brief.continuity_notes}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
