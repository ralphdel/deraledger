/**
 * DeraLedger — Verification Retry Queue Service
 *
 * Manages exponential backoff retries for failed verification attempts.
 * Called by:
 *  - verification.service.ts on provider failure (enqueueRetry)
 *  - /api/cron/kyc-retry route (processRetryQueue)
 *  - /api/admin/retry-queue route (getQueueStats, triggerManualRetry)
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Exponential backoff schedule in minutes */
const RETRY_SCHEDULE_MINUTES = [1, 5, 15, 30];
const MAX_RETRIES = RETRY_SCHEDULE_MINUTES.length;

export interface RetryQueueStats {
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  total: number;
}

export interface RetryQueueItem {
  id: string;
  verification_log_id: string;
  provider_name: string;
  retry_attempt: number;
  next_retry_at: string;
  status: string;
  last_error: string | null;
  created_at: string;
}

/**
 * Adds a failed verification to the retry queue.
 * Calculates next_retry_at using exponential backoff schedule.
 */
export async function enqueueRetry(
  verificationLogId: string,
  providerName: string,
  lastError: string,
  currentAttempt: number = 0
): Promise<{ queued: boolean; nextRetryAt: string | null }> {
  if (currentAttempt >= MAX_RETRIES) {
    return { queued: false, nextRetryAt: null };
  }

  const delayMinutes = RETRY_SCHEDULE_MINUTES[currentAttempt];
  const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  try {
    const sb = getServiceClient();
    await sb.from('verification_retry_queue').insert({
      verification_log_id: verificationLogId,
      provider_name: providerName,
      retry_attempt: currentAttempt + 1,
      next_retry_at: nextRetryAt,
      status: 'pending',
      last_error: lastError,
    });
    return { queued: true, nextRetryAt };
  } catch (err: any) {
    console.error('[RetryService] Failed to enqueue retry:', err?.message);
    return { queued: false, nextRetryAt: null };
  }
}

/**
 * Processes all pending retry queue items whose next_retry_at has passed.
 * Called by the KYC retry cron job.
 * Returns number of items processed.
 */
export async function processRetryQueue(): Promise<{ processed: number; errors: number }> {
  const sb = getServiceClient();
  let processed = 0;
  let errors = 0;

  try {
    // Fetch pending items due for retry
    const { data: items, error } = await sb
      .from('verification_retry_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(50);

    if (error || !items) return { processed: 0, errors: 1 };

    for (const item of items) {
      try {
        // Mark as processing
        await sb
          .from('verification_retry_queue')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', item.id);

        // Check if max retries exceeded
        if (item.retry_attempt >= MAX_RETRIES) {
          await sb
            .from('verification_retry_queue')
            .update({ status: 'abandoned', updated_at: new Date().toISOString() })
            .eq('id', item.id);

          // Update parent log status to provider_down
          await sb
            .from('verification_logs')
            .update({ normalized_status: 'provider_down' })
            .eq('id', item.verification_log_id);

          processed++;
          continue;
        }

        // Re-attempt verification via the gateway
        // Import dynamically to avoid circular deps
        const { retryVerificationFromLog } = await import('./verification.service');
        const retryResult = await retryVerificationFromLog(item.verification_log_id, item.provider_name);

        if (retryResult.success) {
          await sb
            .from('verification_retry_queue')
            .update({ status: 'succeeded', updated_at: new Date().toISOString() })
            .eq('id', item.id);
        } else {
          // Schedule next retry if not at max
          if (item.retry_attempt < MAX_RETRIES) {
            const nextDelay = RETRY_SCHEDULE_MINUTES[item.retry_attempt] || 30;
            const nextRetryAt = new Date(Date.now() + nextDelay * 60 * 1000).toISOString();
            await sb
              .from('verification_retry_queue')
              .update({
                status: 'pending',
                retry_attempt: item.retry_attempt + 1,
                next_retry_at: nextRetryAt,
                last_error: retryResult.error || 'Unknown error',
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.id);
          } else {
            await sb
              .from('verification_retry_queue')
              .update({ status: 'abandoned', updated_at: new Date().toISOString() })
              .eq('id', item.id);
          }
        }
        processed++;
      } catch (itemErr: any) {
        errors++;
        console.error('[RetryService] Error processing queue item:', item.id, itemErr?.message);
        await sb
          .from('verification_retry_queue')
          .update({ status: 'failed', last_error: itemErr?.message, updated_at: new Date().toISOString() })
          .eq('id', item.id);
      }
    }
  } catch (outerErr: any) {
    console.error('[RetryService] processRetryQueue outer error:', outerErr?.message);
    errors++;
  }

  return { processed, errors };
}

/**
 * Returns aggregate stats for the retry queue admin dashboard.
 */
export async function getQueueStats(): Promise<RetryQueueStats> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from('verification_retry_queue')
      .select('status');

    const counts: Record<string, number> = { pending: 0, processing: 0, succeeded: 0, failed: 0, abandoned: 0 };
    for (const row of data || []) {
      if (row.status in counts) counts[row.status]++;
    }
    return { ...counts, total: (data || []).length } as RetryQueueStats;
  } catch {
    return { pending: 0, processing: 0, succeeded: 0, failed: 0, abandoned: 0, total: 0 };
  }
}

/**
 * Returns the most recent retry queue items for the admin dashboard.
 */
export async function getQueueItems(limit = 20): Promise<RetryQueueItem[]> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from('verification_retry_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []) as RetryQueueItem[];
  } catch {
    return [];
  }
}

/**
 * Manually triggers an immediate retry for a specific queue item.
 * Sets next_retry_at to now and status to pending.
 */
export async function triggerManualRetry(queueItemId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const sb = getServiceClient();
    const { error } = await sb
      .from('verification_retry_queue')
      .update({
        status: 'pending',
        next_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', queueItemId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}
