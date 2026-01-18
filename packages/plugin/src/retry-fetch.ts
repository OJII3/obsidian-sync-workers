/**
 * Retry-enabled fetch with exponential backoff
 *
 * Handles transient network errors by automatically retrying requests
 * with increasing delays between attempts.
 */

export interface RetryOptions {
	/** Maximum number of retry attempts (default: 4) */
	maxRetries?: number;
	/** Initial delay in milliseconds (default: 2000) */
	initialDelayMs?: number;
	/** Maximum delay in milliseconds (default: 16000) */
	maxDelayMs?: number;
	/** Multiplier for exponential backoff (default: 2) */
	backoffMultiplier?: number;
	/** HTTP status codes that should trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
	retryableStatusCodes?: number[];
	/** Callback for logging retry attempts */
	onRetry?: (attempt: number, error: Error | Response, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
	maxRetries: 4,
	initialDelayMs: 2000,
	maxDelayMs: 16000,
	backoffMultiplier: 2,
	retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Check if an error is a network error that should be retried
 */
function isNetworkError(error: unknown): boolean {
	if (error instanceof TypeError) {
		// TypeError is thrown for network failures in fetch
		const message = error.message.toLowerCase();
		return (
			message.includes("network") ||
			message.includes("failed to fetch") ||
			message.includes("load failed") ||
			message.includes("networkerror")
		);
	}
	return false;
}

/**
 * Check if a response status code should trigger a retry
 */
function isRetryableStatus(status: number, retryableStatusCodes: number[]): boolean {
	return retryableStatusCodes.includes(status);
}

/**
 * Calculate delay for the current retry attempt using exponential backoff
 */
function calculateDelay(
	attempt: number,
	initialDelayMs: number,
	maxDelayMs: number,
	backoffMultiplier: number,
): number {
	// Add jitter to prevent thundering herd
	const jitter = Math.random() * 0.3 + 0.85; // 0.85 to 1.15
	const delay = Math.min(initialDelayMs * backoffMultiplier ** (attempt - 1), maxDelayMs);
	return Math.round(delay * jitter);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on network errors and specific HTTP status codes
 *
 * @param url - The URL to fetch
 * @param init - Fetch options
 * @param options - Retry configuration options
 * @returns The fetch response
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```ts
 * const response = await retryFetch('/api/data', {
 *   method: 'POST',
 *   body: JSON.stringify(data),
 * }, {
 *   maxRetries: 3,
 *   onRetry: (attempt, error, delay) => {
 *     console.log(`Retry ${attempt} after ${delay}ms`);
 *   }
 * });
 * ```
 */
export async function retryFetch(
	url: string | URL,
	init?: RequestInit,
	options?: RetryOptions,
): Promise<Response> {
	const config = { ...DEFAULT_OPTIONS, ...options };
	let lastError: Error | undefined;
	let attempt = 0;

	while (attempt <= config.maxRetries) {
		try {
			const response = await fetch(url, init);

			// Check if the response status is retryable
			if (isRetryableStatus(response.status, config.retryableStatusCodes)) {
				if (attempt < config.maxRetries) {
					const delay = calculateDelay(
						attempt + 1,
						config.initialDelayMs,
						config.maxDelayMs,
						config.backoffMultiplier,
					);

					options?.onRetry?.(attempt + 1, response, delay);

					await sleep(delay);
					attempt++;
					continue;
				}
			}

			// Success or non-retryable status
			return response;
		} catch (error) {
			if (isNetworkError(error)) {
				lastError = error as Error;

				if (attempt < config.maxRetries) {
					const delay = calculateDelay(
						attempt + 1,
						config.initialDelayMs,
						config.maxDelayMs,
						config.backoffMultiplier,
					);

					options?.onRetry?.(attempt + 1, error as Error, delay);

					await sleep(delay);
					attempt++;
					continue;
				}
			}

			// Non-retryable error or max retries reached
			throw error;
		}
	}

	// Should not reach here, but just in case
	throw lastError || new Error("Max retries exceeded");
}

/**
 * Create a retry-enabled fetch function with preset options
 *
 * @param defaultOptions - Default retry options for all requests
 * @returns A fetch function with retry support
 *
 * @example
 * ```ts
 * const fetchWithRetry = createRetryFetch({
 *   maxRetries: 3,
 *   onRetry: (attempt, error, delay) => {
 *     console.log(`Retry ${attempt}`);
 *   }
 * });
 *
 * const response = await fetchWithRetry('/api/data');
 * ```
 */
export function createRetryFetch(defaultOptions: RetryOptions) {
	return (url: string | URL, init?: RequestInit, options?: RetryOptions): Promise<Response> => {
		return retryFetch(url, init, { ...defaultOptions, ...options });
	};
}
