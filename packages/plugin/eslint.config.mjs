import eslint from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					// Extra words to preserve casing (defaults already include URL, API, ID, etc.)
					ignoreWords: ["URI", "R2", "Cloudflare", "Workers"],
					// Skip strings that aren't natural-language UI text
					ignoreRegex: [
						"https?://",
						"^obsidian://",
						"^[✓✗]",
						"^[a-z]+$",
					],
				},
			],
			// Relax some TypeScript rules for existing code
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
			"@typescript-eslint/no-unsafe-return": "warn",
		},
	},
	{
		ignores: ["main.js", "*.config.js", "*.config.mjs"],
	},
);
