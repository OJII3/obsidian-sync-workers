export function healthHandler() {
	return () => ({
		name: "Obsidian Sync Workers",
		version: "0.1.0",
		status: "ok",
	});
}
