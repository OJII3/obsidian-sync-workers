import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SyncSettings } from "../types";

type ConflictResolutionValue = "local" | "remote" | "cancel";

let fetchHandler: ((url: string | URL, init?: RequestInit) => Promise<Response>) | null = null;
let nextResolution: ConflictResolutionValue = "local";

const baseContentStorePath = import.meta.resolve("../base-content-store");
const conflictModalPath = import.meta.resolve("../conflict-modal");
const retryFetchPath = import.meta.resolve("../retry-fetch");

mock.module("obsidian", () => {
	class TFile {
		path: string;
		stat: { mtime: number };

		constructor(path: string, mtime: number) {
			this.path = path;
			this.stat = { mtime };
		}
	}

	return { TFile };
});

mock.module(baseContentStorePath, () => {
	class BaseContentStore {
		private store = new Map<string, string>();

		async init(): Promise<void> {}

		async get(path: string): Promise<string | undefined> {
			return this.store.get(path);
		}

		async set(path: string, content: string): Promise<void> {
			this.store.set(path, content);
		}

		async delete(path: string): Promise<void> {
			this.store.delete(path);
		}

		async cleanup(): Promise<number> {
			return 0;
		}

		async migrateFromSettings(): Promise<number> {
			return 0;
		}
	}

	const instance = new BaseContentStore();

	return {
		BaseContentStore,
		getBaseContentStore: () => instance,
	};
});

mock.module(conflictModalPath, () => {
	const ConflictResolution = {
		UseLocal: "local",
		UseRemote: "remote",
		Cancel: "cancel",
	} as const;

	class ConflictResolutionModal {
		open() {}
		waitForResult(): Promise<ConflictResolutionValue> {
			return Promise.resolve(nextResolution);
		}

		constructor(_app: unknown, _path: string, _localContent: string, _remoteContent: string) {}
	}

	return {
		ConflictResolution,
		ConflictResolutionModal,
	};
});

mock.module(retryFetchPath, () => {
	return {
		retryFetch: async (url: string | URL, init?: RequestInit) => {
			if (!fetchHandler) {
				throw new Error("fetch handler not configured");
			}
			return fetchHandler(url, init);
		},
	};
});

const { SyncService } = await import("../sync-service");
const { ConflictResolution } = await import("../conflict-modal");
const { TFile } = await import("obsidian");

class MockVault {
	private files = new Map<
		string,
		{ file: InstanceType<typeof TFile>; content: string | ArrayBuffer; binary: boolean }
	>();
	private folders = new Set<string>();

	constructor(
		initialFiles: Array<{ path: string; content: string | ArrayBuffer; binary?: boolean }> = [],
	) {
		for (const entry of initialFiles) {
			this.writeFile(entry.path, entry.content, entry.binary ?? false);
		}
	}

	getAbstractFileByPath(path: string) {
		return this.files.get(path)?.file ?? (this.folders.has(path) ? { path } : null);
	}

	getMarkdownFiles() {
		return [...this.files.values()]
			.filter((entry) => entry.file.path.endsWith(".md"))
			.map((entry) => entry.file);
	}

	getFiles() {
		return [...this.files.values()].map((entry) => entry.file);
	}

	async read(file: InstanceType<typeof TFile>): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry || entry.binary) {
			throw new Error(`Missing text file: ${file.path}`);
		}
		return entry.content as string;
	}

	async readBinary(file: InstanceType<typeof TFile>): Promise<ArrayBuffer> {
		const entry = this.files.get(file.path);
		if (!entry || !entry.binary) {
			throw new Error(`Missing binary file: ${file.path}`);
		}
		return entry.content as ArrayBuffer;
	}

	async modify(file: InstanceType<typeof TFile>, content: string): Promise<void> {
		this.writeFile(file.path, content, false, true);
	}

	async modifyBinary(file: InstanceType<typeof TFile>, data: ArrayBuffer): Promise<void> {
		this.writeFile(file.path, data, true, true);
	}

	async create(path: string, content: string): Promise<InstanceType<typeof TFile>> {
		return this.writeFile(path, content, false);
	}

	async createBinary(path: string, data: ArrayBuffer): Promise<InstanceType<typeof TFile>> {
		return this.writeFile(path, data, true);
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	async delete(file: InstanceType<typeof TFile>): Promise<void> {
		this.files.delete(file.path);
	}

	private writeFile(
		path: string,
		content: string | ArrayBuffer,
		binary: boolean,
		updateTime = false,
	) {
		const existing = this.files.get(path);
		const mtime = updateTime || !existing ? Date.now() : existing.file.stat.mtime;
		const file = existing?.file ?? new TFile(path, mtime);
		file.stat.mtime = mtime;
		this.files.set(path, { file, content, binary });
		return file;
	}
}

class MockApiClient {
	requests: Array<{ method: string; url: URL; body?: BodyInit | null }> = [];
	private handlers: Array<{
		method: string;
		pathname: string | RegExp;
		handler: (options: { url: URL; body?: BodyInit | null }) => Response | Promise<Response>;
	}> = [];

	on(
		method: string,
		pathname: string | RegExp,
		handler: (options: { url: URL; body?: BodyInit | null }) => Response | Promise<Response>,
	) {
		this.handlers.push({ method, pathname, handler });
	}

	async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
		const requestUrl = new URL(typeof url === "string" ? url : url.toString());
		const method = init?.method?.toUpperCase() ?? "GET";
		const body = init?.body ?? null;
		this.requests.push({ method, url: requestUrl, body });
		const match = this.handlers.find((entry) => {
			if (entry.method !== method) return false;
			if (typeof entry.pathname === "string") {
				return entry.pathname === requestUrl.pathname;
			}
			return entry.pathname.test(requestUrl.pathname);
		});

		if (!match) {
			throw new Error(`Unhandled request: ${method} ${requestUrl.pathname}`);
		}

		return match.handler({ url: requestUrl, body });
	}
}

const textEncoder = new TextEncoder();
const bufferFromString = (value: string) => textEncoder.encode(value).buffer;

const createSettings = (overrides: Partial<SyncSettings> = {}): SyncSettings => ({
	serverUrl: "https://example.test",
	vaultId: "vault-123",
	lastSeq: 0,
	lastAttachmentSeq: 0,
	syncAttachments: false,
	metadataCache: {},
	attachmentCache: {},
	...overrides,
});

describe("SyncService", () => {
	beforeEach(() => {
		fetchHandler = null;
		nextResolution = ConflictResolution.UseLocal;
	});

	it("resolves conflicts by using the local version", async () => {
		const api = new MockApiClient();
		api.on("GET", "/api/changes", () => Response.json({ results: [], last_seq: 0 }));
		api.on("POST", "/api/docs/bulk_docs", ({ body }) => {
			const payload = JSON.parse(String(body));
			expect(payload.docs).toHaveLength(1);
			return Response.json([
				{
					id: "notes/conflict",
					error: "conflict",
					current_rev: "2-remote",
					current_content: "Remote content",
				},
			]);
		});
		api.on("PUT", "/api/docs/notes%2Fconflict", ({ body }) => {
			const payload = JSON.parse(String(body));
			expect(payload.content).toBe("Local content");
			return Response.json({ ok: true, rev: "3-local" });
		});

		fetchHandler = api.fetch.bind(api);

		const vault = new MockVault([{ path: "notes/conflict.md", content: "Local content" }]);
		const statusUpdates: string[] = [];

		const service = new SyncService(
			{} as never,
			vault as never,
			createSettings(),
			async () => {},
			(status) => statusUpdates.push(status.status),
		);

		nextResolution = ConflictResolution.UseLocal;
		await service.performSync();

		const updatedContent = await vault.read(
			vault.getAbstractFileByPath("notes/conflict.md") as InstanceType<typeof TFile>,
		);
		expect(updatedContent).toBe("Local content");
		expect(api.requests.some((request) => request.method === "PUT")).toBe(true);
		expect(statusUpdates).toContain("success");
	});

	it("resolves conflicts by using the remote version", async () => {
		const api = new MockApiClient();
		api.on("GET", "/api/changes", () => Response.json({ results: [], last_seq: 0 }));
		api.on("POST", "/api/docs/bulk_docs", () =>
			Response.json([
				{
					id: "notes/conflict",
					error: "conflict",
					current_rev: "2-remote",
					current_content: "Remote version",
				},
			]),
		);

		fetchHandler = api.fetch.bind(api);

		const vault = new MockVault([{ path: "notes/conflict.md", content: "Local version" }]);
		const service = new SyncService(
			{} as never,
			vault as never,
			createSettings(),
			async () => {},
			() => {},
		);

		nextResolution = ConflictResolution.UseRemote;
		await service.performSync();

		const updatedContent = await vault.read(
			vault.getAbstractFileByPath("notes/conflict.md") as InstanceType<typeof TFile>,
		);
		expect(updatedContent).toBe("Remote version");
		expect(api.requests.some((request) => request.method === "PUT")).toBe(false);
	});

	it("runs attachment sync flow for upload, changes feed, and download", async () => {
		const api = new MockApiClient();
		api.on("GET", "/api/changes", () => Response.json({ results: [], last_seq: 0 }));
		api.on("POST", "/api/docs/bulk_docs", () => Response.json([]));
		api.on("GET", "/api/attachments/changes", () =>
			Response.json({
				results: [{ id: "remote-1", path: "assets/remote.png", hash: "remote-hash" }],
				last_seq: 1,
			}),
		);
		api.on("GET", "/api/attachments/remote-1/content", () => {
			return new Response(bufferFromString("remote-data"), {
				status: 200,
				headers: {
					"Content-Type": "image/png",
					"X-Attachment-Hash": "remote-hash",
				},
			});
		});
		api.on("PUT", "/api/attachments/assets%2Fphoto.png", ({ body }) => {
			const data = body as ArrayBuffer;
			return Response.json({
				ok: true,
				hash: "local-hash",
				size: data.byteLength,
				content_type: "image/png",
			});
		});

		fetchHandler = api.fetch.bind(api);

		const vault = new MockVault([
			{ path: "assets/photo.png", content: bufferFromString("local-data"), binary: true },
		]);
		const service = new SyncService(
			{} as never,
			vault as never,
			createSettings({ syncAttachments: true }),
			async () => {},
			() => {},
		);

		await service.performSync();

		const uploaded = api.requests.some(
			(request) => request.method === "PUT" && request.url.pathname.includes("photo.png"),
		);
		expect(uploaded).toBe(true);

		const remoteFile = vault.getAbstractFileByPath("assets/remote.png") as InstanceType<
			typeof TFile
		>;
		const remoteContent = await vault.readBinary(remoteFile);
		expect(new TextDecoder().decode(new Uint8Array(remoteContent))).toBe("remote-data");
	});

	it("reports sync errors when the network fails", async () => {
		fetchHandler = async () => {
			throw new TypeError("Failed to fetch");
		};

		const vault = new MockVault([{ path: "notes/error.md", content: "Content" }]);
		const statuses: Array<{ status: string; errors?: number }> = [];

		const service = new SyncService(
			{} as never,
			vault as never,
			createSettings(),
			async () => {},
			(status) => statuses.push({ status: status.status, errors: status.stats?.errors }),
		);

		await service.performSync();

		expect(statuses.at(-1)?.status).toBe("error");
		expect(statuses.at(-1)?.errors).toBe(1);
	});
});
