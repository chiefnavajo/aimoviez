'use client';

// ============================================================================
// ADMIN PRICING DASHBOARD
// Manage model pricing, credit packages, margins, and AI pricing alerts.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Check,
  X,
  DollarSign,
  TrendingUp,
  Zap,
  Save,
  Loader2,
  Settings,
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useCsrf } from '@/hooks/useCsrf';

// ============================================================================
// TYPES
// ============================================================================

interface ModelPricing {
  id: string;
  model_key: string;
  display_name: string;
  fal_cost_cents: number;
  credit_cost: number;
  target_margin_percent: number;
  min_credit_cost: number | null;
  is_active: boolean;
  cost_drift_detected: boolean;
  last_cost_check_at: string | null;
  // Enriched fields from API
  theoretical_margin_percent: number;
  actual_margin_percent_7d: number | null;
  generation_count_7d: number;
  avg_cost_cents_7d: number | null;
}

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  bonus_percent: number;
  sort_order: number;
  is_active: boolean;
  stripe_price_id: string | null;
}

interface RevenueBucket {
  purchases: number;
  gross_cents: number;
  stripe_fees_cents: number;
  ai_costs_cents: number;
  overhead_cents: number;
  profit_cents: number;
  margin_percent: number;
}

interface PricingAlert {
  id: string;
  model_key: string;
  alert_type: string;
  severity: string;
  current_margin_percent: number | null;
  recommended_credit_cost: number | null;
  ai_analysis: string | null;
  is_resolved: boolean;
  created_at: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AdminPricingPage() {
  const { isLoading: authLoading, isAdmin } = useAdminAuth();
  const { getHeaders } = useCsrf();

  const [models, setModels] = useState<ModelPricing[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [alerts, setAlerts] = useState<PricingAlert[]>([]);
  const [worstCaseCentsPerCredit, setWorstCaseCentsPerCredit] = useState(0);
  const [revenue, setRevenue] = useState<{
    today: RevenueBucket;
    week: RevenueBucket;
    month: RevenueBucket;
  } | null>(null);
  const [monthlyOverheadCents, setMonthlyOverheadCents] = useState(0);
  const [editingOverhead, setEditingOverhead] = useState(false);
  const [overheadInput, setOverheadInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Editable state
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editModelForm, setEditModelForm] = useState<{
    fal_cost_cents: number;
    credit_cost: number;
    target_margin_percent: number;
  }>({ fal_cost_cents: 0, credit_cost: 0, target_margin_percent: 35 });

  const [editingPackage, setEditingPackage] = useState<string | null>(null);
  const [editPkgForm, setEditPkgForm] = useState<{
    credits: number;
    price_cents: number;
    bonus_percent: number;
  }>({ credits: 0, price_cents: 0, bonus_percent: 0 });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchPricing = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/pricing');
      const data = await res.json();
      if (data.success) {
        setModels(data.models || []);
        setPackages(data.packages || []);
        setAlerts(data.alerts || []);
        setWorstCaseCentsPerCredit(data.worst_case_cents_per_credit || 0);
        setRevenue(data.revenue || null);
        setMonthlyOverheadCents(data.monthly_overhead_cents || 0);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to fetch pricing data' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchPricing();
  }, [isAdmin, fetchPricing]);

  // ============================================================================
  // MODEL PRICING ACTIONS
  // ============================================================================

  const startEditModel = (model: ModelPricing) => {
    setEditingModel(model.model_key);
    setEditModelForm({
      fal_cost_cents: model.fal_cost_cents,
      credit_cost: model.credit_cost,
      target_margin_percent: model.target_margin_percent,
    });
  };

  const saveModel = async (modelKey: string) => {
    setSaving(modelKey);
    try {
      const res = await fetch('/api/admin/pricing/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ model_key: modelKey, ...editModelForm }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Updated ${modelKey}${data.warning ? ` (Warning: ${data.warning})` : ''}` });
        setEditingModel(null);
        fetchPricing();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(null);
    }
  };

  // ============================================================================
  // PACKAGE ACTIONS
  // ============================================================================

  const startEditPackage = (pkg: CreditPackage) => {
    setEditingPackage(pkg.id);
    setEditPkgForm({
      credits: pkg.credits,
      price_cents: pkg.price_cents,
      bonus_percent: pkg.bonus_percent,
    });
  };

  const savePackage = async (pkgId: string) => {
    setSaving(pkgId);
    try {
      const res = await fetch('/api/admin/pricing/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ id: pkgId, ...editPkgForm }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Package updated${data.note ? ` (${data.note})` : ''}` });
        setEditingPackage(null);
        fetchPricing();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(null);
    }
  };

  // ============================================================================
  // RECALCULATE + ALERT ACTIONS
  // ============================================================================

  const recalculateAll = async () => {
    setRecalculating(true);
    try {
      const res = await fetch('/api/admin/pricing/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
      });
      const data = await res.json();
      if (data.success) {
        const changes = data.result?.changes?.length || 0;
        setMessage({ type: 'success', text: `Recalculated. ${changes} model(s) adjusted.` });
        fetchPricing();
      } else {
        setMessage({ type: 'error', text: data.error || 'Recalculation failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setRecalculating(false);
    }
  };

  const saveOverhead = async () => {
    const cents = Math.round(parseFloat(overheadInput) * 100);
    if (isNaN(cents) || cents < 0) {
      setMessage({ type: 'error', text: 'Enter a valid dollar amount' });
      return;
    }
    setSaving('overhead');
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ monthly_overhead_cents: cents }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Monthly overhead set to $${(cents / 100).toFixed(2)}` });
        setEditingOverhead(false);
        fetchPricing();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(null);
    }
  };

  const resolveAlert = async (alertId: string, apply: boolean, alert: PricingAlert) => {
    setSaving(alertId);
    try {
      if (apply && alert.recommended_credit_cost) {
        // Apply the recommendation first
        await fetch('/api/admin/pricing/models', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({
            model_key: alert.model_key,
            credit_cost: alert.recommended_credit_cost,
          }),
        });
      }

      // Mark alert as resolved via direct Supabase call through admin pricing endpoint
      // For simplicity, we'll refetch after the model update
      setAlerts(prev => prev.filter(a => a.id !== alertId));
      setMessage({ type: 'success', text: apply ? 'Recommendation applied' : 'Alert dismissed' });
      if (apply) fetchPricing();
    } catch {
      setMessage({ type: 'error', text: 'Failed to resolve alert' });
    } finally {
      setSaving(null);
    }
  };

  // ============================================================================
  // MARGIN STATUS HELPER
  // ============================================================================

  const getMarginStatus = (margin: number) => {
    if (margin < 25) return { color: 'text-red-400', bg: 'bg-red-500/20', label: 'Critical' };
    if (margin < 30) return { color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Low' };
    if (margin <= 40) return { color: 'text-green-400', bg: 'bg-green-500/20', label: 'Target' };
    if (margin <= 50) return { color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'High' };
    return { color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Very High' };
  };

  // ============================================================================
  // AUTH GUARD
  // ============================================================================

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#050510] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#050510] text-white flex items-center justify-center">
        <p className="text-red-400">Admin access required</p>
      </div>
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-[#050510] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#050510]/90 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                Pricing Dashboard
              </h1>
              <p className="text-xs text-white/50">Manage model costs, credit packages, and margins</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={recalculateAll}
              disabled={recalculating}
              className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition flex items-center gap-2 text-sm disabled:opacity-50"
            >
              {recalculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Recalculate All
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={fetchPricing}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition"
            >
              <RefreshCw className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Toast Message */}
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-3 rounded-lg flex items-center justify-between ${
              message.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
            }`}
          >
            <span className="text-sm">{message.text}</span>
            <button onClick={() => setMessage(null)}><X className="w-4 h-4" /></button>
          </motion.div>
        )}

        {/* Key Metric */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Worst-Case $/Credit</div>
            <div className="text-2xl font-bold text-cyan-400">{worstCaseCentsPerCredit.toFixed(2)}c</div>
            <div className="text-xs text-white/40">From largest package (Studio)</div>
          </div>
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Active Models</div>
            <div className="text-2xl font-bold">{models.filter(m => m.is_active).length}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Unresolved Alerts</div>
            <div className={`text-2xl font-bold ${alerts.length > 0 ? 'text-orange-400' : 'text-green-400'}`}>
              {alerts.length}
            </div>
          </div>
        </div>

        {/* Revenue & Profit */}
        {revenue && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                Revenue & Profit
              </h2>
              <div className="flex items-center gap-2 text-sm">
                <Settings className="w-4 h-4 text-white/40" />
                <span className="text-white/50">Monthly overhead:</span>
                {editingOverhead ? (
                  <div className="flex items-center gap-1">
                    <span className="text-white/60">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={overheadInput}
                      onChange={e => setOverheadInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveOverhead()}
                      className="w-24 bg-white/10 rounded px-2 py-1 text-right text-sm font-mono"
                      autoFocus
                    />
                    <button
                      onClick={saveOverhead}
                      disabled={saving === 'overhead'}
                      className="p-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 disabled:opacity-50"
                    >
                      {saving === 'overhead' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => setEditingOverhead(false)}
                      className="p-1 rounded bg-white/10 text-white/60 hover:bg-white/20"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setOverheadInput((monthlyOverheadCents / 100).toFixed(2)); setEditingOverhead(true); }}
                    className="font-mono text-cyan-400 hover:text-cyan-300 transition"
                  >
                    ${(monthlyOverheadCents / 100).toFixed(2)}/mo
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([
                { label: 'Today', data: revenue.today },
                { label: 'This Week', data: revenue.week },
                { label: 'This Month', data: revenue.month },
              ] as const).map(({ label, data }) => {
                const marginStatus = getMarginStatus(data.margin_percent);
                return (
                  <div key={label} className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <div className="text-xs text-white/50 mb-3 uppercase tracking-wider">{label}</div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/60">Revenue</span>
                        <span className="font-mono text-white">${(data.gross_cents / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">AI Costs</span>
                        <span className="font-mono text-red-400">-${(data.ai_costs_cents / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Stripe Fees</span>
                        <span className="font-mono text-red-400">-${(data.stripe_fees_cents / 100).toFixed(2)}</span>
                      </div>
                      {data.overhead_cents > 0 && (
                        <div className="flex justify-between">
                          <span className="text-white/60">Overhead</span>
                          <span className="font-mono text-orange-400">-${(data.overhead_cents / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="border-t border-white/10 pt-1.5 mt-1.5">
                        <div className="flex justify-between">
                          <span className="text-white font-medium">Profit</span>
                          <span className={`font-mono font-bold ${data.profit_cents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {data.profit_cents >= 0 ? '+' : ''}${(data.profit_cents / 100).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-white/60">Margin</span>
                          <span className={`font-mono font-medium ${marginStatus.color}`}>
                            {data.gross_cents > 0 ? `${data.margin_percent}%` : '-'}
                          </span>
                        </div>
                        <div className="text-xs text-white/40 mt-2">
                          {data.purchases} purchase{data.purchases !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pricing Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
              Pricing Alerts
            </h2>
            {alerts.map(alert => (
              <div
                key={alert.id}
                className={`p-4 rounded-xl border ${
                  alert.severity === 'critical'
                    ? 'bg-red-500/10 border-red-500/30'
                    : alert.severity === 'warning'
                    ? 'bg-orange-500/10 border-orange-500/30'
                    : 'bg-blue-500/10 border-blue-500/30'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        alert.severity === 'critical' ? 'bg-red-500/30 text-red-300' :
                        alert.severity === 'warning' ? 'bg-orange-500/30 text-orange-300' :
                        'bg-blue-500/30 text-blue-300'
                      }`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="text-sm font-medium">{alert.model_key}</span>
                      <span className="text-xs text-white/50">{alert.alert_type.replace('_', ' ')}</span>
                    </div>
                    {alert.current_margin_percent !== null && (
                      <div className="text-sm text-white/60 mb-1">
                        Current margin: <span className="font-mono">{alert.current_margin_percent}%</span>
                        {alert.recommended_credit_cost && (
                          <> | Recommended: <span className="font-mono text-green-400">{alert.recommended_credit_cost} credits</span></>
                        )}
                      </div>
                    )}
                    {alert.ai_analysis && (
                      <p className="text-xs text-white/50 mt-1">{alert.ai_analysis}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {alert.recommended_credit_cost && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => resolveAlert(alert.id, true, alert)}
                        disabled={saving === alert.id}
                        className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-300 hover:bg-green-500/30 text-xs font-medium disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5 inline mr-1" />Apply
                      </motion.button>
                    )}
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => resolveAlert(alert.id, false, alert)}
                      disabled={saving === alert.id}
                      className="px-3 py-1.5 rounded-lg bg-white/10 text-white/60 hover:bg-white/20 text-xs font-medium disabled:opacity-50"
                    >
                      Dismiss
                    </motion.button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Model Pricing Table */}
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-purple-400" />
            Model Pricing
          </h2>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-purple-400" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/50 text-xs uppercase border-b border-white/10">
                    <th className="text-left py-3 px-3">Model</th>
                    <th className="text-right py-3 px-3">fal.ai Cost</th>
                    <th className="text-right py-3 px-3">Credits</th>
                    <th className="text-right py-3 px-3">Min Credits</th>
                    <th className="text-right py-3 px-3">Target %</th>
                    <th className="text-right py-3 px-3">Margin</th>
                    <th className="text-right py-3 px-3">7d Actual</th>
                    <th className="text-right py-3 px-3">7d Gens</th>
                    <th className="text-center py-3 px-3">Status</th>
                    <th className="text-center py-3 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map(model => {
                    const isEditing = editingModel === model.model_key;
                    const margin = model.theoretical_margin_percent;
                    const status = getMarginStatus(margin);
                    const belowMin = model.min_credit_cost !== null && model.credit_cost < model.min_credit_cost;

                    return (
                      <tr key={model.model_key} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-3 px-3">
                          <div className="font-medium">{model.display_name}</div>
                          <div className="text-xs text-white/40">{model.model_key}</div>
                          {model.cost_drift_detected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">DRIFT</span>
                          )}
                        </td>
                        <td className="text-right py-3 px-3 font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editModelForm.fal_cost_cents}
                              onChange={e => setEditModelForm(f => ({ ...f, fal_cost_cents: parseInt(e.target.value) || 0 }))}
                              className="w-20 bg-white/10 rounded px-2 py-1 text-right text-sm"
                            />
                          ) : (
                            <>{model.fal_cost_cents}c</>
                          )}
                        </td>
                        <td className={`text-right py-3 px-3 font-mono ${belowMin ? 'text-red-400' : ''}`}>
                          {isEditing ? (
                            <input
                              type="number"
                              value={editModelForm.credit_cost}
                              onChange={e => setEditModelForm(f => ({ ...f, credit_cost: parseInt(e.target.value) || 0 }))}
                              className="w-16 bg-white/10 rounded px-2 py-1 text-right text-sm"
                            />
                          ) : (
                            <>{model.credit_cost}{belowMin && <AlertTriangle className="w-3 h-3 inline ml-1 text-red-400" />}</>
                          )}
                        </td>
                        <td className="text-right py-3 px-3 font-mono text-white/50">
                          {model.min_credit_cost ?? '-'}
                        </td>
                        <td className="text-right py-3 px-3 font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editModelForm.target_margin_percent}
                              onChange={e => setEditModelForm(f => ({ ...f, target_margin_percent: parseInt(e.target.value) || 35 }))}
                              className="w-16 bg-white/10 rounded px-2 py-1 text-right text-sm"
                            />
                          ) : (
                            <>{model.target_margin_percent}%</>
                          )}
                        </td>
                        <td className="text-right py-3 px-3">
                          <span className={`font-mono font-medium ${status.color}`}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-right py-3 px-3 font-mono text-white/50">
                          {model.actual_margin_percent_7d !== null ? `${model.actual_margin_percent_7d.toFixed(1)}%` : '-'}
                        </td>
                        <td className="text-right py-3 px-3 font-mono text-white/50">
                          {model.generation_count_7d}
                        </td>
                        <td className="text-center py-3 px-3">
                          <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${status.bg} ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="text-center py-3 px-3">
                          {isEditing ? (
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => saveModel(model.model_key)}
                                disabled={saving === model.model_key}
                                className="p-1.5 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 disabled:opacity-50"
                              >
                                {saving === model.model_key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => setEditingModel(null)}
                                className="p-1.5 rounded bg-white/10 text-white/60 hover:bg-white/20"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEditModel(model)}
                              className="text-xs px-2 py-1 rounded bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Credit Packages Table */}
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
            <DollarSign className="w-5 h-5 text-green-400" />
            Credit Packages
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/50 text-xs uppercase border-b border-white/10">
                  <th className="text-left py-3 px-3">Name</th>
                  <th className="text-right py-3 px-3">Credits</th>
                  <th className="text-right py-3 px-3">Price</th>
                  <th className="text-right py-3 px-3">Bonus %</th>
                  <th className="text-right py-3 px-3">Total Credits</th>
                  <th className="text-right py-3 px-3">$/Credit</th>
                  <th className="text-center py-3 px-3">Active</th>
                  <th className="text-center py-3 px-3">Stripe</th>
                  <th className="text-center py-3 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {packages.map(pkg => {
                  const isEditing = editingPackage === pkg.id;
                  const totalCredits = pkg.credits + Math.floor(pkg.credits * pkg.bonus_percent / 100);
                  const centsPerCredit = totalCredits > 0 ? pkg.price_cents / totalCredits : 0;
                  const isWorstCase = Math.abs(centsPerCredit - worstCaseCentsPerCredit) < 0.01;

                  return (
                    <tr key={pkg.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-3 font-medium">{pkg.name}</td>
                      <td className="text-right py-3 px-3 font-mono">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editPkgForm.credits}
                            onChange={e => setEditPkgForm(f => ({ ...f, credits: parseInt(e.target.value) || 0 }))}
                            className="w-20 bg-white/10 rounded px-2 py-1 text-right text-sm"
                          />
                        ) : pkg.credits}
                      </td>
                      <td className="text-right py-3 px-3 font-mono">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editPkgForm.price_cents}
                            onChange={e => setEditPkgForm(f => ({ ...f, price_cents: parseInt(e.target.value) || 0 }))}
                            className="w-20 bg-white/10 rounded px-2 py-1 text-right text-sm"
                          />
                        ) : (
                          `$${(pkg.price_cents / 100).toFixed(2)}`
                        )}
                      </td>
                      <td className="text-right py-3 px-3 font-mono">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editPkgForm.bonus_percent}
                            onChange={e => setEditPkgForm(f => ({ ...f, bonus_percent: parseInt(e.target.value) || 0 }))}
                            className="w-16 bg-white/10 rounded px-2 py-1 text-right text-sm"
                          />
                        ) : (
                          `${pkg.bonus_percent}%`
                        )}
                      </td>
                      <td className="text-right py-3 px-3 font-mono text-white/50">{totalCredits}</td>
                      <td className={`text-right py-3 px-3 font-mono ${isWorstCase ? 'text-orange-400 font-bold' : 'text-white/70'}`}>
                        {centsPerCredit.toFixed(2)}c
                        {isWorstCase && <span className="text-[10px] ml-1">WORST</span>}
                      </td>
                      <td className="text-center py-3 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${pkg.is_active ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                          {pkg.is_active ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="text-center py-3 px-3">
                        <span className={`text-xs ${pkg.stripe_price_id ? 'text-green-400' : 'text-white/30'}`}>
                          {pkg.stripe_price_id ? 'Linked' : 'None'}
                        </span>
                      </td>
                      <td className="text-center py-3 px-3">
                        {isEditing ? (
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => savePackage(pkg.id)}
                              disabled={saving === pkg.id}
                              className="p-1.5 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 disabled:opacity-50"
                            >
                              {saving === pkg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => setEditingPackage(null)}
                              className="p-1.5 rounded bg-white/10 text-white/60 hover:bg-white/20"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditPackage(pkg)}
                            className="text-xs px-2 py-1 rounded bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
