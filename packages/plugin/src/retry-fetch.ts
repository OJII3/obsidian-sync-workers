/**
 * Retry-enabled fetch with exponential backoff
 *
 * Handles transient network errors by automatically retrying requests
 * with increasing delays between attempts.
 *
 * Uses Obsidian's requestUrl for network requests as per plugin guidelines.
 */

import { type RequestUrlParam, type RequestUrlResponse, requestUrl } from "obsidian";

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
	onRetry?: (attempt: number, error: Error | ResponseWrapper, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
	maxRetries: 4,
	initialDelayMs: 2000,
	maxDelayMs: 16000,
	backoffMultiplier: 2,
	retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Response wrapper that provides a fetch-like interface for RequestUrlResponse
 */
export class ResponseWrapper {
	readonly status: number;
	readonly ok: boolean;
	readonly statusText: string;
	readonly headers: Record<string, string>;
	private _json: unknown;
	private _text: string;
	private _arrayBuffer: ArrayBuffer;

	constructor(response: RequestUrlResponse) {
		this.status = response.status;
		this.ok = response.status >= 200 && response.status < 300;
		this.statusText = this.getStatusText(response.status);
		this.headers = response.headers;
		this._json = response.json;
		this._text = response.text;
		this._arrayBuffer = response.arrayBuffer;
	}

	private getStatusText(status: number): string {
		const statusTexts: Record<number, string> = {
			200: "OK",
			201: "Created",
			204: "No Content",
			400: "Bad Request",
			401: "Unauthorized",
			403: "Forbidden",
			404: "Not Found",
			409: "Conflict",
			413: "Payload Too Large",
			429: "Too Many Requests",
			500: "Internal Server Error",
			502: "Bad Gateway",
			503: "Service Unavailable",
			504: "Gateway Timeout",
		};
		return statusTexts[status] || "Unknown";
	}

	async json(): Promise<unknown> {
		return this._json;
	}

	async text(): Promise<string> {
		return this._text;
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		return this._arrayBuffer;
	}
}

/**
 * Check if an error is a network error that should be retried
 */
function isNetworkError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes("network") ||
			message.includes("failed to fetch") ||
			message.includes("load failed") ||
			message.includes("networkerror") ||
			message.includes("net::") ||
			message.includes("request failed")
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
 * Uses Obsidian's requestUrl for network requests as per plugin guidelines.
 *
 * @param url - The URL to fetch
 * @param init - Fetch options (compatible with standard fetch API)
 * @param options - Retry configuration options
 * @returns A Response-like wrapper for the response
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
): Promise<ResponseWrapper> {
	const config = { ...DEFAULT_OPTIONS, ...options };
	let lastError: Error | undefined;
	let attempt = 0;

	// Convert URL object to string
	const urlString = url.toString();

	// Convert RequestInit to RequestUrlParam
	const requestParams: RequestUrlParam = {
		url: urlString,
		method: init?.method,
		headers: init?.headers as Record<string, string> | undefined,
		body: init?.body as string | ArrayBuffer | undefined,
		throw: false, // Don't throw on non-2xx status codes
	};

	while (attempt <= config.maxRetries) {
		try {
			const response = await requestUrl(requestParams);
			const wrappedResponse = new ResponseWrapper(response);

			// Check if the response status is retryable
			if (isRetryableStatus(wrappedResponse.status, config.retryableStatusCodes)) {
				if (attempt < config.maxRetries) {
					const delay = calculateDelay(
						attempt + 1,
						config.initialDelayMs,
						config.maxDelayMs,
						config.backoffMultiplier,
					);

					options?.onRetry?.(attempt + 1, wrappedResponse, delay);

					await sleep(delay);
					attempt++;
					continue;
				}
			}

			// Success or non-retryable status
			return wrappedResponse;
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
	return (
		url: string | URL,
		init?: RequestInit,
		options?: RetryOptions,
	): Promise<ResponseWrapper> => {
		return retryFetch(url, init, { ...defaultOptions, ...options });
	};
}
