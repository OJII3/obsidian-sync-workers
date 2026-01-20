import type { SyncSettings } from "./types";

export function buildAuthHeaders(settings: SyncSettings, extra?: HeadersInit): Headers {
	const apiKey = settings.apiKey.trim();
	if (!apiKey) {
		throw new Error("API key is required. Set it in the plugin settings.");
	}

	const headers = new Headers(extra);
	headers.set("Authorization", `Bearer ${apiKey}`);
	return headers;
}
