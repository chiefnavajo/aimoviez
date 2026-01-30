'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  Trash2,
  AlertTriangle,
  Loader2,
  Check,
  Shield,
  FileText,
  Cookie,
  LogOut,
  User,
  X,
  Smartphone,
} from 'lucide-react';
import { InstallPrompt } from '@/components/InstallPrompt';
import { useCsrf } from '@/hooks/useCsrf';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { getHeaders } = useCsrf();

  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Redirect if not logged in
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!session) {
    router.push('/');
    return null;
  }

  const handleExportData = async () => {
    setExporting(true);
    setExportSuccess(false);

    try {
      const response = await fetch('/api/account/export');

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Get the blob and create download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aimoviez-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export data. Please try again.');
    }

    setExporting(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE MY ACCOUNT') {
      setDeleteError('Please type "DELETE MY ACCOUNT" exactly to confirm');
      return;
    }

    setDeleting(true);
    setDeleteError('');

    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Deletion failed');
      }

      // Clear local storage and sign out
      localStorage.removeItem('user_profile');
      localStorage.setItem('hasUsedAppBefore', 'true');
      await signOut({ redirect: false });
      window.location.href = '/?deleted=true';
    } catch (error) {
      console.error('Delete error:', error);
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete account');
    }

    setDeleting(false);
  };

  const resetCookieConsent = () => {
    localStorage.removeItem('aimoviez_cookie_consent');
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/profile">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </motion.button>
            </Link>
            <h1 className="text-xl font-bold">Settings</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Account Section */}
        <section>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-cyan-400" />
            Account
          </h2>
          <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/10">
            <div className="p-4 flex items-center gap-4">
              <Image
                src={session.user?.image || '/default-avatar.png'}
                alt="Profile"
                width={48}
                height={48}
                className="w-12 h-12 rounded-full"
              />
              <div>
                <p className="font-medium">{session.user?.name}</p>
                <p className="text-sm text-white/60">{session.user?.email}</p>
              </div>
            </div>
            <Link href="/profile">
              <div className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer">
                <span>Edit Profile</span>
                <ArrowLeft className="w-5 h-5 rotate-180 text-white/40" />
              </div>
            </Link>
          </div>
        </section>

        {/* App Section */}
        <section>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            App
          </h2>
          <InstallPrompt variant="settings" />
        </section>

        {/* Legal Section */}
        <section>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Legal
          </h2>
          <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/10">
            <Link href="/terms">
              <div className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer">
                <span>Terms of Service</span>
                <ArrowLeft className="w-5 h-5 rotate-180 text-white/40" />
              </div>
            </Link>
            <Link href="/privacy">
              <div className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer">
                <span>Privacy Policy</span>
                <ArrowLeft className="w-5 h-5 rotate-180 text-white/40" />
              </div>
            </Link>
            <button
              onClick={resetCookieConsent}
              className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <Cookie className="w-5 h-5 text-white/60" />
                <span>Cookie Preferences</span>
              </div>
              <span className="text-sm text-cyan-400">Reset</span>
            </button>
          </div>
        </section>

        {/* Privacy & Data Section */}
        <section>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            Privacy & Data
          </h2>
          <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/10">
            {/* Export Data */}
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Export Your Data</p>
                  <p className="text-sm text-white/60">Download all your data in JSON format</p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleExportData}
                  disabled={exporting}
                  className="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg font-medium hover:bg-cyan-500/30 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {exporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : exportSuccess ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {exporting ? 'Exporting...' : exportSuccess ? 'Downloaded!' : 'Export'}
                </motion.button>
              </div>
            </div>

            {/* Delete Account */}
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-red-400">Delete Account</p>
                  <p className="text-sm text-white/60">Permanently delete your account and all data</p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowDeleteModal(true)}
                  className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg font-medium hover:bg-red-500/30 transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </motion.button>
              </div>
            </div>
          </div>
        </section>

        {/* Sign Out */}
        <section>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={async () => {
              localStorage.removeItem('user_profile');
              localStorage.setItem('hasUsedAppBefore', 'true');
              await signOut({ redirect: false });
              window.location.href = '/?from=logout';
            }}
            className="w-full p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors flex items-center justify-center gap-3 text-white/80"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </motion.button>
        </section>

        {/* App Info */}
        <div className="text-center text-white/40 text-sm pt-4">
          <p>AiMoviez v1.0.0</p>
          <p className="mt-1">Made with passion</p>
        </div>
      </main>

      {/* Delete Account Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowDeleteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#1a1a2e] rounded-2xl border border-red-500/30 p-6 max-w-md w-full"
            >
              {/* Header */}
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 rounded-xl bg-red-500/20">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Delete Account</h2>
                  <p className="text-sm text-white/60">This action cannot be undone</p>
                </div>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="ml-auto p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Warning */}
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
                <p className="text-sm text-red-300">
                  <strong>Warning:</strong> This will permanently delete:
                </p>
                <ul className="text-sm text-red-300/80 mt-2 space-y-1 ml-4">
                  <li>• Your profile and account</li>
                  <li>• All your uploaded clips</li>
                  <li>• All your votes and comments</li>
                  <li>• All your notifications and data</li>
                </ul>
              </div>

              {/* Confirmation Input */}
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                  Type <span className="text-red-400 font-mono">DELETE MY ACCOUNT</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:border-red-500 focus:outline-none transition-colors"
                />
                {deleteError && (
                  <p className="text-sm text-red-400 mt-2">{deleteError}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleting}
                  className="flex-1 py-3 bg-white/10 rounded-xl font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirmation !== 'DELETE MY ACCOUNT'}
                  className="flex-1 py-3 bg-red-500 rounded-xl font-bold hover:bg-red-600 transition-colors disabled:opacity-50 disabled:bg-red-500/50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete Forever
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
