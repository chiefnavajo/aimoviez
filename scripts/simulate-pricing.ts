#!/usr/bin/env npx tsx
/**
 * AIMoviez Pricing Simulation
 *
 * Models costs and profits for the credit monetization system.
 * Every video generation requires credits — no free tier, no bonuses.
 * Uses REAL pricing data from the codebase (model costs, credit packages).
 *
 * Usage:
 *   npx tsx scripts/simulate-pricing.ts
 *   npm run simulate:pricing
 *
 * No external dependencies. No DB or API calls. Pure calculation.
 */

// =============================================================================
// ANSI COLORS (no chalk dependency)
// =============================================================================

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

function colorMargin(pct: number): string {
  const s = pct.toFixed(1) + '%';
  if (pct > 35) return `${C.green}${s}${C.reset}`;
  if (pct >= 20) return `${C.yellow}${s}${C.reset}`;
  if (pct >= 0) return `${C.red}${s}${C.reset}`;
  return `${C.bgRed}${C.white}${s}${C.reset}`;
}

function colorProfit(cents: number): string {
  const s = fmtDollar(cents);
  if (cents > 0) return `${C.green}+${s}${C.reset}`;
  if (cents < 0) return `${C.red}${s}${C.reset}`;
  return `${C.yellow}${s}${C.reset}`;
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

function fmtDollar(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return neg ? `-$${s}` : `$${s}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function pad(s: string, len: number, align: 'left' | 'right' = 'left'): string {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
  const diff = len - stripped.length;
  if (diff <= 0) return s;
  if (align === 'right') return ' '.repeat(diff) + s;
  return s + ' '.repeat(diff);
}

// =============================================================================
// ASCII TABLE RENDERER
// =============================================================================

function renderTable(
  headers: string[],
  rows: string[][],
  aligns?: ('left' | 'right')[]
): string {
  const cols = headers.length;
  const defaultAligns = aligns || headers.map(() => 'left');
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let max = strip(headers[c]).length;
    for (const row of rows) {
      max = Math.max(max, strip(row[c] || '').length);
    }
    widths.push(max + 2);
  }
  const sep = '+' + widths.map(w => '-'.repeat(w)).join('+') + '+';
  const fmtRow = (cells: string[]) =>
    '|' + cells.map((cell, i) => pad(` ${cell} `, widths[i], defaultAligns[i])).join('|') + '|';
  const lines = [sep, fmtRow(headers), sep];
  for (const row of rows) lines.push(fmtRow(row));
  lines.push(sep);
  return lines.join('\n');
}

// =============================================================================
// DATA TYPES
// =============================================================================

interface ModelPricing {
  modelKey: string;
  displayName: string;
  falCostCents: number;
  creditCost: number;
}

interface CreditPackage {
  name: string;
  priceCents: number;
  credits: number;
  centsPerCredit: number;
}

interface SimulationConfig {
  dau: number;
  gensPerUserPerDay: number;
  stripeFeePercent: number;
  stripeFeeFixedCents: number;
  monthlyInfraCostCents: number;
  modelUsageDistribution: Record<string, number>;
  packagePurchaseDistribution: Record<string, number>;
}

interface DailyResult {
  totalGens: number;
  totalFalCostCents: number;
  grossRevenueCents: number;
  stripeFeesCents: number;
  infraCostCentsPerDay: number;
  totalCostCents: number;
  profitCents: number;
  marginPercent: number;
}

interface ModelBreakdown {
  modelKey: string;
  displayName: string;
  gens: number;
  falCostCents: number;
  revenueCents: number;
  profitCents: number;
  marginPercent: number;
}

interface PackageBreakdown {
  name: string;
  purchasesPerMonth: number;
  grossRevenueCents: number;
  stripeFeesCents: number;
  netRevenueCents: number;
  creditsDistributed: number;
}

interface ScenarioResult {
  name: string;
  description: string;
  config: SimulationConfig;
  daily: DailyResult;
  monthly: DailyResult;
  models: ModelBreakdown[];
  packages: PackageBreakdown[];
}

// =============================================================================
// PRICING DATA — from src/lib/ai-video.ts COST_DEFAULTS
// =============================================================================

const MODELS: ModelPricing[] = [
  { modelKey: 'kling-2.6',    displayName: 'Kling 2.6',           falCostCents: 35,  creditCost: 7  },
  { modelKey: 'hailuo-2.3',   displayName: 'Hailuo 2.3',         falCostCents: 49,  creditCost: 10 },
  { modelKey: 'veo3-fast',    displayName: 'Veo3 Fast',          falCostCents: 80,  creditCost: 15 },
  { modelKey: 'sora-2',       displayName: 'Sora 2',             falCostCents: 80,  creditCost: 15 },
  { modelKey: 'kling-o1-ref', displayName: 'Kling O1 Reference', falCostCents: 56,  creditCost: 11 },
];

// No bonuses — credits = what you get
const PACKAGES: CreditPackage[] = [
  { name: 'Try It',  priceCents: 99,   credits: 7,   centsPerCredit: 99 / 7 },
  { name: 'Starter', priceCents: 299,  credits: 25,  centsPerCredit: 299 / 25 },
  { name: 'Popular', priceCents: 599,  credits: 55,  centsPerCredit: 599 / 55 },
  { name: 'Pro',     priceCents: 999,  credits: 100, centsPerCredit: 999 / 100 },
  { name: 'Studio',  priceCents: 2499, credits: 250, centsPerCredit: 2499 / 250 },
];

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: SimulationConfig = {
  dau: 1000,
  gensPerUserPerDay: 2.5,
  stripeFeePercent: 0.029,
  stripeFeeFixedCents: 30,
  monthlyInfraCostCents: 6700,       // $67/mo (Vercel $20 + Supabase $25 + Redis $10 + misc $12)

  modelUsageDistribution: {
    'kling-2.6':    0.40,
    'hailuo-2.3':   0.25,
    'veo3-fast':    0.20,
    'sora-2':       0.10,
    'kling-o1-ref': 0.05,
  },

  packagePurchaseDistribution: {
    'Try It':  0.15,
    'Starter': 0.25,
    'Popular': 0.30,
    'Pro':     0.20,
    'Studio':  0.10,
  },
};

// =============================================================================
// CORE CALCULATION ENGINE
// =============================================================================

function worstCaseCentsPerCredit(): number {
  return Math.min(...PACKAGES.map(p => p.centsPerCredit));
}

function bestCaseCentsPerCredit(): number {
  return Math.max(...PACKAGES.map(p => p.centsPerCredit));
}

function weightedAvgCentsPerCredit(config: SimulationConfig): number {
  let totalCents = 0;
  let totalWeight = 0;
  for (const pkg of PACKAGES) {
    const weight = config.packagePurchaseDistribution[pkg.name] || 0;
    totalCents += pkg.centsPerCredit * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? totalCents / totalWeight : worstCaseCentsPerCredit();
}

function runScenario(
  name: string,
  description: string,
  configOverrides: Partial<SimulationConfig>
): ScenarioResult {
  const config: SimulationConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  const totalGens = Math.round(config.dau * config.gensPerUserPerDay);
  const avgCPC = weightedAvgCentsPerCredit(config);

  // Per-model breakdown
  let totalFalCostCents = 0;
  let totalRevenueCents = 0;
  const modelBreakdowns: ModelBreakdown[] = [];

  for (const model of MODELS) {
    const share = config.modelUsageDistribution[model.modelKey] || 0;
    const gens = Math.round(totalGens * share);
    const cost = gens * model.falCostCents;
    const revenue = gens * model.creditCost * avgCPC;
    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    totalFalCostCents += cost;
    totalRevenueCents += revenue;

    modelBreakdowns.push({
      modelKey: model.modelKey,
      displayName: model.displayName,
      gens,
      falCostCents: cost,
      revenueCents: revenue,
      profitCents: profit,
      marginPercent: margin,
    });
  }

  // Package revenue: credits consumed → purchases needed
  const totalCreditsPerDay = MODELS.reduce((sum, m) => {
    const share = config.modelUsageDistribution[m.modelKey] || 0;
    return sum + Math.round(totalGens * share) * m.creditCost;
  }, 0);
  const totalCreditsPerMonth = totalCreditsPerDay * 30;

  // Weighted average purchase size
  let creditsPerAvgPurchase = 0;
  let revenuePerAvgPurchase = 0;
  for (const pkg of PACKAGES) {
    const weight = config.packagePurchaseDistribution[pkg.name] || 0;
    creditsPerAvgPurchase += pkg.credits * weight;
    revenuePerAvgPurchase += pkg.priceCents * weight;
  }

  const totalPurchasesPerMonth = Math.ceil(totalCreditsPerMonth / creditsPerAvgPurchase);
  const grossRevenuePerMonth = Math.round(totalPurchasesPerMonth * revenuePerAvgPurchase);

  let stripeFeesPerMonth = 0;
  const packageBreakdowns: PackageBreakdown[] = [];

  for (const pkg of PACKAGES) {
    const weight = config.packagePurchaseDistribution[pkg.name] || 0;
    const purchases = Math.round(totalPurchasesPerMonth * weight);
    const gross = purchases * pkg.priceCents;
    const fees = purchases * (Math.round(pkg.priceCents * config.stripeFeePercent) + config.stripeFeeFixedCents);
    stripeFeesPerMonth += fees;

    packageBreakdowns.push({
      name: pkg.name,
      purchasesPerMonth: purchases,
      grossRevenueCents: gross,
      stripeFeesCents: fees,
      netRevenueCents: gross - fees,
      creditsDistributed: purchases * pkg.credits,
    });
  }

  // Daily
  const dailyGrossRevenue = Math.round(grossRevenuePerMonth / 30);
  const dailyStripeFees = Math.round(stripeFeesPerMonth / 30);
  const dailyInfra = Math.round(config.monthlyInfraCostCents / 30);
  const dailyTotalCost = totalFalCostCents + dailyStripeFees + dailyInfra;
  const dailyProfit = dailyGrossRevenue - dailyTotalCost;
  const dailyMargin = dailyGrossRevenue > 0 ? (dailyProfit / dailyGrossRevenue) * 100 : 0;

  const daily: DailyResult = {
    totalGens,
    totalFalCostCents,
    grossRevenueCents: dailyGrossRevenue,
    stripeFeesCents: dailyStripeFees,
    infraCostCentsPerDay: dailyInfra,
    totalCostCents: dailyTotalCost,
    profitCents: dailyProfit,
    marginPercent: dailyMargin,
  };

  // Monthly
  const monthlyTotalCost = totalFalCostCents * 30 + stripeFeesPerMonth + config.monthlyInfraCostCents;
  const monthlyProfit = grossRevenuePerMonth - monthlyTotalCost;
  const monthlyMargin = grossRevenuePerMonth > 0 ? (monthlyProfit / grossRevenuePerMonth) * 100 : 0;

  const monthly: DailyResult = {
    totalGens: totalGens * 30,
    totalFalCostCents: totalFalCostCents * 30,
    grossRevenueCents: grossRevenuePerMonth,
    stripeFeesCents: stripeFeesPerMonth,
    infraCostCentsPerDay: config.monthlyInfraCostCents,
    totalCostCents: monthlyTotalCost,
    profitCents: monthlyProfit,
    marginPercent: monthlyMargin,
  };

  return { name, description, config, daily, monthly, models: modelBreakdowns, packages: packageBreakdowns };
}

// =============================================================================
// OUTPUT RENDERING
// =============================================================================

function printHeader() {
  const now = new Date().toISOString().split('.')[0] + 'Z';
  console.log('');
  console.log(`${C.bold}${'='.repeat(80)}${C.reset}`);
  console.log(`${C.bold}  AIMOVIEZ PRICING SIMULATION${C.reset}`);
  console.log(`${C.dim}  Generated: ${now}${C.reset}`);
  console.log(`${C.dim}  Model: ALL generations are PAID (no free tier, no bonuses)${C.reset}`);
  console.log(`${C.dim}  Data source: COST_DEFAULTS from src/lib/ai-video.ts${C.reset}`);
  console.log(`${C.bold}${'='.repeat(80)}${C.reset}`);
}

function printSourceData() {
  console.log(`\n${C.bold}${C.cyan}=== SOURCE DATA ===${C.reset}\n`);

  console.log(`${C.bold}AI Video Models:${C.reset}`);
  console.log(renderTable(
    ['Model', 'fal.ai Cost', 'Credits', 'Worst Margin', 'Best Margin'],
    MODELS.map(m => {
      const worst = (1 - m.falCostCents / (m.creditCost * worstCaseCentsPerCredit())) * 100;
      const best = (1 - m.falCostCents / (m.creditCost * bestCaseCentsPerCredit())) * 100;
      return [m.displayName, `${m.falCostCents}¢`, String(m.creditCost), colorMargin(worst), colorMargin(best)];
    }),
    ['left', 'right', 'right', 'right', 'right']
  ));

  console.log(`\n${C.bold}Credit Packages (no bonuses):${C.reset}`);
  console.log(renderTable(
    ['Package', 'Price', 'Credits', '¢/credit'],
    PACKAGES.map(p => [
      p.name,
      fmtDollar(p.priceCents),
      String(p.credits),
      `${p.centsPerCredit.toFixed(2)}¢`,
    ]),
    ['left', 'right', 'right', 'right']
  ));

  console.log(`\n${C.dim}  Worst-case ¢/credit: ${worstCaseCentsPerCredit().toFixed(2)}¢ (Studio — bulk buyers)${C.reset}`);
  console.log(`${C.dim}  Best-case ¢/credit:  ${bestCaseCentsPerCredit().toFixed(2)}¢ (Try It — small buyers)${C.reset}`);
}

function printScenario(result: ScenarioResult) {
  const { daily, monthly, models, packages, config } = result;

  console.log(`\n${C.bold}${C.cyan}${'='.repeat(80)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${result.name}${C.reset}`);
  console.log(`${C.dim}  ${result.description}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'='.repeat(80)}${C.reset}`);

  // --- DAILY ---
  console.log(`\n${C.bold}--- DAILY BREAKDOWN ---${C.reset}\n`);
  const rows = [
    ['Users generating', `${fmtNum(config.dau)}`, `${C.dim}(${config.gensPerUserPerDay} gens/user/day)${C.reset}`],
    ['Total generations', `${fmtNum(daily.totalGens)}`, ''],
    ['', '', ''],
    ['fal.ai cost', `${C.red}-${fmtDollar(daily.totalFalCostCents)}${C.reset}`, `${C.dim}(${((daily.totalFalCostCents / (daily.totalCostCents || 1)) * 100).toFixed(0)}% of costs)${C.reset}`],
    ['Stripe fees', `${C.red}-${fmtDollar(daily.stripeFeesCents)}${C.reset}`, ''],
    ['Infrastructure', `${C.red}-${fmtDollar(daily.infraCostCentsPerDay)}${C.reset}`, `${C.dim}($${(config.monthlyInfraCostCents / 100).toFixed(0)}/mo)${C.reset}`],
    ['TOTAL COST', `${C.bold}${C.red}-${fmtDollar(daily.totalCostCents)}${C.reset}`, ''],
    ['', '', ''],
    ['Gross Revenue', `${C.green}+${fmtDollar(daily.grossRevenueCents)}${C.reset}`, ''],
    ['', '', ''],
    [`${C.bold}NET PROFIT${C.reset}`, colorProfit(daily.profitCents), colorMargin(daily.marginPercent)],
  ];

  for (const row of rows) {
    if (row[0] === '' && row[1] === '' && row[2] === '') { console.log(''); continue; }
    console.log(`  ${pad(row[0], 22)} ${pad(row[1], 16, 'right')}  ${row[2]}`);
  }

  // --- MONTHLY ---
  console.log(`\n${C.bold}--- MONTHLY PROJECTION (×30) ---${C.reset}\n`);
  console.log(renderTable(
    ['Metric', 'Daily', 'Monthly'],
    [
      ['Generations', fmtNum(daily.totalGens), fmtNum(monthly.totalGens)],
      ['fal.ai cost', fmtDollar(daily.totalFalCostCents), fmtDollar(monthly.totalFalCostCents)],
      ['Stripe fees', fmtDollar(daily.stripeFeesCents), fmtDollar(monthly.stripeFeesCents)],
      ['Infrastructure', fmtDollar(daily.infraCostCentsPerDay), fmtDollar(monthly.infraCostCentsPerDay)],
      ['Total cost', fmtDollar(daily.totalCostCents), fmtDollar(monthly.totalCostCents)],
      ['Gross revenue', fmtDollar(daily.grossRevenueCents), fmtDollar(monthly.grossRevenueCents)],
      ['NET PROFIT', colorProfit(daily.profitCents), colorProfit(monthly.profitCents)],
      ['Margin', colorMargin(daily.marginPercent), colorMargin(monthly.marginPercent)],
    ],
    ['left', 'right', 'right']
  ));

  // --- PER-MODEL ---
  console.log(`\n${C.bold}--- PER-MODEL BREAKDOWN (daily) ---${C.reset}\n`);
  console.log(renderTable(
    ['Model', 'Gens', 'fal Cost', 'Revenue', 'Profit', 'Margin'],
    models.map(m => [
      m.displayName,
      fmtNum(m.gens),
      fmtDollar(m.falCostCents),
      fmtDollar(m.revenueCents),
      colorProfit(m.profitCents),
      colorMargin(m.marginPercent),
    ]),
    ['left', 'right', 'right', 'right', 'right', 'right']
  ));

  // --- PACKAGES ---
  console.log(`\n${C.bold}--- PACKAGE REVENUE (monthly) ---${C.reset}\n`);
  console.log(renderTable(
    ['Package', 'Purchases', 'Gross Rev', 'Stripe Fee', 'Net Rev', 'Credits'],
    packages.map(p => [
      p.name,
      fmtNum(p.purchasesPerMonth),
      fmtDollar(p.grossRevenueCents),
      fmtDollar(p.stripeFeesCents),
      fmtDollar(p.netRevenueCents),
      fmtNum(p.creditsDistributed),
    ]),
    ['left', 'right', 'right', 'right', 'right', 'right']
  ));

  // --- UNIT ECONOMICS ---
  const avgCPC = weightedAvgCentsPerCredit(config);
  const weightedCreditCost = MODELS.reduce((sum, m) => {
    const share = config.modelUsageDistribution[m.modelKey] || 0;
    return sum + m.creditCost * share;
  }, 0);
  const weightedFalCost = MODELS.reduce((sum, m) => {
    const share = config.modelUsageDistribution[m.modelKey] || 0;
    return sum + m.falCostCents * share;
  }, 0);
  const avgRevenuePerGen = weightedCreditCost * avgCPC;
  const avgProfitPerGen = avgRevenuePerGen - weightedFalCost;

  console.log(`\n${C.bold}--- UNIT ECONOMICS ---${C.reset}\n`);
  console.log(`  Avg credits/gen:       ${weightedCreditCost.toFixed(1)}`);
  console.log(`  Avg ¢/credit:          ${avgCPC.toFixed(2)}¢`);
  console.log(`  Avg revenue/gen:       ${fmtDollar(avgRevenuePerGen)}`);
  console.log(`  Avg fal.ai cost/gen:   ${fmtDollar(weightedFalCost)}`);
  console.log(`  Avg profit/gen:        ${colorProfit(avgProfitPerGen)}`);
  console.log(`  Avg margin/gen:        ${colorMargin((avgProfitPerGen / avgRevenuePerGen) * 100)}`);
}

function printComparativeSummary(results: ScenarioResult[]) {
  console.log(`\n${C.bold}${C.cyan}${'='.repeat(80)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  COMPARATIVE SUMMARY${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'='.repeat(80)}${C.reset}\n`);

  console.log(renderTable(
    ['#', 'Scenario', 'DAU', 'Gens/d', 'Cost/mo', 'Revenue/mo', 'Profit/mo', 'Margin'],
    results.map((r, i) => [
      String.fromCharCode(65 + i),
      r.name.replace(/^Scenario [A-Z]: /, ''),
      fmtNum(r.config.dau),
      fmtNum(r.daily.totalGens),
      fmtDollar(r.monthly.totalCostCents),
      fmtDollar(r.monthly.grossRevenueCents),
      colorProfit(r.monthly.profitCents),
      colorMargin(r.monthly.marginPercent),
    ]),
    ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right']
  ));

  const bestScenario = results.reduce((best, r) => r.monthly.profitCents > best.monthly.profitCents ? r : best);
  const worstScenario = results.reduce((worst, r) => r.monthly.profitCents < worst.monthly.profitCents ? r : worst);

  console.log(`\n${C.bold}KEY INSIGHTS:${C.reset}`);
  console.log(`  ${C.green}Best scenario:${C.reset}  ${bestScenario.name} → ${colorProfit(bestScenario.monthly.profitCents)}/mo at ${colorMargin(bestScenario.monthly.marginPercent)} margin`);
  console.log(`  ${C.red}Worst scenario:${C.reset} ${worstScenario.name} → ${colorProfit(worstScenario.monthly.profitCents)}/mo at ${colorMargin(worstScenario.monthly.marginPercent)} margin`);
  console.log(`\n  ${C.dim}fal.ai is ${((results[0].monthly.totalFalCostCents / results[0].monthly.totalCostCents) * 100).toFixed(0)}% of total costs. Everything else is negligible.${C.reset}`);
  console.log(`  ${C.dim}Weighted avg ¢/credit: ${weightedAvgCentsPerCredit(DEFAULT_CONFIG).toFixed(2)}¢ (mix of all packages)${C.reset}`);
  console.log(`  ${C.dim}All generations are paid — no free tier, no bonuses.${C.reset}`);
  console.log('');
}

// =============================================================================
// SCENARIOS
// =============================================================================

const SCENARIOS: Array<{ name: string; description: string; overrides: Partial<SimulationConfig> }> = [
  {
    name: 'Scenario A: 1K Users',
    description: '1,000 DAU × 2.5 gens/day = 2,500 generations/day',
    overrides: {},
  },
  {
    name: 'Scenario B: 1K Heavy Usage',
    description: '1,000 DAU × 5 gens/day = 5,000 generations/day',
    overrides: { gensPerUserPerDay: 5 },
  },
  {
    name: 'Scenario C: 5K Users',
    description: '5,000 DAU × 2.5 gens/day = 12,500 generations/day',
    overrides: { dau: 5000 },
  },
  {
    name: 'Scenario D: 10K Users',
    description: '10,000 DAU × 2.5 gens/day = 25,000 generations/day',
    overrides: { dau: 10000 },
  },
];

// =============================================================================
// MAIN
// =============================================================================

function main() {
  printHeader();
  printSourceData();

  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    const result = runScenario(scenario.name, scenario.description, scenario.overrides);
    results.push(result);
    printScenario(result);
  }

  printComparativeSummary(results);
}

main();
