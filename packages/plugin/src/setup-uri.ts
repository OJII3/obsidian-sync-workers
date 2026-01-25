const SETUP_URI_PREFIX = "obsidian://setup-sync-workers?data=";
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export interface SetupData {
	serverUrl: string;
	apiKey: string;
	vaultId: string;
	version: number;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(passphrase),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

function encodeBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export async function encryptSetupData(data: SetupData, passphrase: string): Promise<string> {
	const encoder = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(passphrase, salt);

	const plaintext = encoder.encode(JSON.stringify(data));
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

	// Pack: version(1 byte) + salt(16 bytes) + iv(12 bytes) + ciphertext
	const packed = new Uint8Array(1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
	packed[0] = FORMAT_VERSION;
	packed.set(salt, 1);
	packed.set(iv, 1 + SALT_LENGTH);
	packed.set(new Uint8Array(ciphertext), 1 + SALT_LENGTH + IV_LENGTH);

	return SETUP_URI_PREFIX + encodeURIComponent(encodeBase64(packed.buffer));
}

export async function decryptSetupURI(uri: string, passphrase: string): Promise<SetupData> {
	const rawDataStr = uri.startsWith(SETUP_URI_PREFIX) ? uri.slice(SETUP_URI_PREFIX.length) : uri;

	let dataStr: string;
	try {
		dataStr = decodeURIComponent(rawDataStr);
	} catch {
		dataStr = rawDataStr;
	}

	const packed = decodeBase64(dataStr);

	const version = packed[0];
	if (version !== FORMAT_VERSION) {
		throw new Error(`Unsupported setup URI format version: ${version}`);
	}

	const salt = packed.slice(1, 1 + SALT_LENGTH);
	const iv = packed.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
	const ciphertext = packed.slice(1 + SALT_LENGTH + IV_LENGTH);

	const key = await deriveKey(passphrase, salt);

	let plaintext: ArrayBuffer;
	try {
		plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
	} catch {
		throw new Error("Decryption failed. Check your passphrase.");
	}

	const decoder = new TextDecoder();
	const data: SetupData = JSON.parse(decoder.decode(plaintext));

	if (!data.serverUrl || !data.apiKey || !data.vaultId) {
		throw new Error("Invalid setup data: missing required fields.");
	}

	return data;
}

export function isSetupURI(uri: string): boolean {
	return uri.startsWith(SETUP_URI_PREFIX);
}
