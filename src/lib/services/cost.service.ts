/**
 * DeraLedger — Verification Cost Service
 *
 * Aggregates verification costs from verification_logs.
 * Used by admin cost monitoring dashboard and spike detection.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface CostSummary {
  totalRequests: number;
  successfulVerifications: number;
  failedVerifications: number;
  duplicatesPrevented: number;
  totalCostNaira: number;
  sandboxRequests: number;
}

export interface CostByProvider {
  provider: string;
  totalCost: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

export interface CostByMerchant {
  merchantId: string;
  merchantName: string;
  totalCost: number;
  requestCount: number;
}

export interface CostByPeriod {
  period: string;
  totalCost: number;
  requestCount: number;
}

export interface CostFilters {
  from?: string;
  to?: string;
  merchantId?: string;
  provider?: string;
}

/**
 * Returns a summary of verification costs.
 */
export async function getCostSummary(filters: CostFilters = {}): Promise<CostSummary> {
  try {
    const sb = getServiceClient();
    let query = sb.from('verification_logs').select('normalized_status, verification_cost, is_sandbox, error_code');
    if (filters.from) query = query.gte('created_at', filters.from);
    if (filters.to)   query = query.lte('created_at', filters.to);
    if (filters.merchantId) query = query.eq('merchant_id', filters.merchantId);
    if (filters.provider)   query = query.eq('provider_name', filters.provider.toUpperCase());

    const { data } = await query;
    const rows = data || [];

    return {
      totalRequests: rows.length,
      successfulVerifications: rows.filter(r => r.normalized_status === 'verified').length,
      failedVerifications: rows.filter(r => r.normalized_status === 'failed').length,
      duplicatesPrevented: rows.filter(r => r.error_code === 'DUPLICATE_REQUEST').length,
      totalCostNaira: rows.reduce((sum, r) => sum + (Number(r.verification_cost) || 0), 0),
      sandboxRequests: rows.filter(r => r.is_sandbox).length,
    };
  } catch {
    return { totalRequests: 0, successfulVerifications: 0, failedVerifications: 0, duplicatesPrevented: 0, totalCostNaira: 0, sandboxRequests: 0 };
  }
}

/**
 * Returns cost breakdown by provider.
 */
export async function getCostByProvider(filters: CostFilters = {}): Promise<CostByProvider[]> {
  try {
    const sb = getServiceClient();
    let query = sb.from('verification_logs').select('provider_name, verification_cost, normalized_status');
    if (filters.from) query = query.gte('created_at', filters.from);
    if (filters.to)   query = query.lte('created_at', filters.to);

    const { data } = await query;
    const rows = data || [];

    const map = new Map<string, CostByProvider>();
    for (const row of rows) {
      const key = row.provider_name;
      if (!map.has(key)) {
        map.set(key, { provider: key, totalCost: 0, requestCount: 0, successCount: 0, failureCount: 0 });
      }
      const entry = map.get(key)!;
      entry.totalCost += Number(row.verification_cost) || 0;
      entry.requestCount++;
      if (row.normalized_status === 'verified') entry.successCount++;
      if (row.normalized_status === 'failed') entry.failureCount++;
    }

    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  } catch {
    return [];
  }
}

/**
 * Returns top merchants by verification cost.
 */
export async function getCostByMerchant(limit = 10, filters: CostFilters = {}): Promise<CostByMerchant[]> {
  try {
    const sb = getServiceClient();
    let query = sb
      .from('verification_logs')
      .select('merchant_id, verification_cost, merchants(business_name)');
    if (filters.from) query = query.gte('created_at', filters.from);
    if (filters.to)   query = query.lte('created_at', filters.to);

    const { data } = await query;
    const rows = data || [];

    const map = new Map<string, CostByMerchant>();
    for (const row of rows) {
      if (!row.merchant_id) continue;
      if (!map.has(row.merchant_id)) {
        const merchant = row.merchants as any;
        map.set(row.merchant_id, {
          merchantId: row.merchant_id,
          merchantName: merchant?.business_name || 'Unknown',
          totalCost: 0,
          requestCount: 0,
        });
      }
      const entry = map.get(row.merchant_id)!;
      entry.totalCost += Number(row.verification_cost) || 0;
      entry.requestCount++;
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Returns cost aggregated by time period.
 */
export async function getCostByPeriod(
  granularity: 'day' | 'week' | 'month' = 'day',
  filters: CostFilters = {}
): Promise<CostByPeriod[]> {
  try {
    const sb = getServiceClient();
    let query = sb.from('verification_logs').select('created_at, verification_cost');
    if (filters.from) query = query.gte('created_at', filters.from);
    if (filters.to)   query = query.lte('created_at', filters.to);

    const { data } = await query;
    const rows = data || [];

    const map = new Map<string, CostByPeriod>();
    for (const row of rows) {
      const date = new Date(row.created_at);
      let key: string;
      if (granularity === 'month') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else if (granularity === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().slice(0, 10);
      } else {
        key = date.toISOString().slice(0, 10);
      }

      if (!map.has(key)) map.set(key, { period: key, totalCost: 0, requestCount: 0 });
      const entry = map.get(key)!;
      entry.totalCost += Number(row.verification_cost) || 0;
      entry.requestCount++;
    }

    return Array.from(map.entries())
      .map(([, v]) => v)
      .sort((a, b) => a.period.localeCompare(b.period));
  } catch {
    return [];
  }
}

/**
 * Detects cost spikes: compares last 24h cost vs 7-day rolling average.
 * Returns spike data if cost exceeds 2x the average.
 */
export async function detectCostSpike(): Promise<{
  spikeDetected: boolean;
  last24hCost: number;
  sevenDayAvgCost: number;
  multiplier: number;
}> {
  try {
    const sb = getServiceClient();
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const last7d  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: recent }, { data: historical }] = await Promise.all([
      sb.from('verification_logs').select('verification_cost').gte('created_at', last24h),
      sb.from('verification_logs').select('verification_cost').gte('created_at', last7d).lt('created_at', last24h),
    ]);

    const last24hCost = (recent || []).reduce((s, r) => s + (Number(r.verification_cost) || 0), 0);
    const historicalTotal = (historical || []).reduce((s, r) => s + (Number(r.verification_cost) || 0), 0);
    const sevenDayAvgCost = (historical || []).length > 0 ? historicalTotal / 6 : 0; // avg per day

    const multiplier = sevenDayAvgCost > 0 ? last24hCost / sevenDayAvgCost : 0;
    return {
      spikeDetected: multiplier > 2,
      last24hCost,
      sevenDayAvgCost,
      multiplier: Math.round(multiplier * 100) / 100,
    };
  } catch {
    return { spikeDetected: false, last24hCost: 0, sevenDayAvgCost: 0, multiplier: 0 };
  }
}
