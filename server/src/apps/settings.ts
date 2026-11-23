// App settings and secrets (component F, FR-006, FR-018). Values are encrypted at rest with the data
// key (spec 009), and secret values are never returned by any route or command. Values written
// before the data key existed are "v1", encrypted with a key derived from the auth secret; the
// server moves them onto the data key when it starts (keys.ts).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Kit } from "../db/schema.ts";

/** The AES-256-GCM key for apps' settings, from the data key (v2) or, before it, the auth secret (v1). */
function key(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "your-space", "app-settings", 32));
}

function seal(version: "v1" | "v2", secret: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function open(version: "v1" | "v2", secret: string, stored: string): string {
  const [found, iv, tag, data] = stored.split(".");
  if (found !== version || !iv || !tag || data === undefined) throw new Error("Unknown setting format.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Encrypts a setting with the data key. */
export function encrypt(dataKey: string, value: string): string {
  return seal("v2", dataKey, value);
}

/** Decrypts a setting encrypted with the data key; throws for any other key or format. */
export function decrypt(dataKey: string, stored: string): string {
  return open("v2", dataKey, stored);
}

/** Decrypts a setting written before the data key, with the auth secret it was encrypted with. */
export function decryptLegacy(authSecret: string, stored: string): string {
  return open("v1", authSecret, stored);
}

/** Writes a setting the way it was before the data key, for tests of the move onto it. */
export function encryptLegacy(authSecret: string, value: string): string {
  return seal("v1", authSecret, value);
}

const SECRET_NAME = /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|(^|_)KEY($|_)|API_?KEY|ENCRYPTION/i;

/** Settings whose names say they hold a secret are never shown. */
export function looksSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

export function generateValue(options: { bytes?: number; encoding?: "hex" | "base64url" } = {}): string {
  return randomBytes(options.bytes ?? 32).toString(options.encoding ?? "base64url");
}

/** `${NAME}` in a kit's derive template: another setting the kit generates, sets or derives from the app's address. */
export const TEMPLATE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function templateNames(template: string): string[] {
  return [...template.matchAll(TEMPLATE_REFERENCE)].map((m) => m[1]!);
}

/** A template setting is secret when any setting it uses is. */
export function templateIsSecret(kit: Kit, template: string): boolean {
  return templateNames(template).some((ref) => kit.generate?.[ref] !== undefined || Boolean(kit.secrets?.includes(ref)) || looksSecret(ref));
}

/**
 * Fills the kit's template settings from the current values of the settings they use. It runs
 * whenever the app's environment is built, so a changed password reaches the URL that contains it.
 * Values are inserted as they are; generated values are hex or base64url, so they are safe in URLs.
 */
export function resolveTemplates(kit: Kit | null, values: Map<string, string | null>): Map<string, string | null> {
  const resolved = new Map(values);
  for (const [name, derive] of Object.entries(kit?.derive ?? {})) {
    if (typeof derive === "string") continue;
    resolved.set(name, derive.template.replace(TEMPLATE_REFERENCE, (_, ref: string) => values.get(ref) ?? ""));
  }
  return resolved;
}

export interface Variable {
  name: string;
  required: boolean;
  default: string;
}

export interface Setting {
  name: string;
  /** Plain text, only in memory. */
  value: string | null;
  secret: boolean;
  generated: boolean;
  derived: boolean;
  required: boolean;
  publishedDefault: string | null;
}

export interface AppAddress {
  origin: string;
  host: string;
}

/**
 * The settings an app's file reads and its kit names, with values Your Space generates or works out.
 * A kit can name settings the file never reads, for a service that loads them from `.env`, which Your
 * Space gives the app's settings to instead. A published default is never used for a secret: the kit
 * says which values to generate, and without a kit any setting that looks secret and has a published
 * default gets a generated value (spec Q3).
 */
export function buildSettings(variables: Variable[], kit: Kit | null, address: AppAddress, previous: Map<string, string | null> = new Map()): Setting[] {
  const names = new Set(variables.map((v) => v.name));
  for (const name of Object.keys(kit?.generate ?? {})) names.add(name);
  for (const name of Object.keys(kit?.derive ?? {})) names.add(name);
  for (const name of Object.keys(kit?.set ?? {})) names.add(name);
  for (const name of [...(kit?.required ?? []), ...(kit?.secrets ?? [])]) names.add(name);
  const byName = new Map(variables.map((v) => [v.name, v]));
  const settings: Setting[] = [];
  for (const name of [...names].sort()) {
    const variable = byName.get(name) ?? { name, required: false, default: "" };
    const derive = kit?.derive?.[name];
    const generate = kit?.generate?.[name];
    const secret =
      Boolean(generate) ||
      Boolean(kit?.secrets?.includes(name)) ||
      looksSecret(name) ||
      (kit !== null && typeof derive === "object" && templateIsSecret(kit, derive.template));
    const kept = previous.get(name);
    let value: string | null = kept ?? null;
    let generated = false;
    if (typeof derive === "object") {
      value = null; // filled below, once the settings it uses have values
    } else if (derive) {
      value = derive === "app_origin" ? address.origin : address.host;
    } else if (generate) {
      value = kept ?? generateValue(generate);
      generated = true;
    } else if (kit?.set?.[name] !== undefined && (kept === undefined || kept === null)) {
      value = kit.set[name]!;
    } else if (!kit && secret && variable.default) {
      value = kept ?? generateValue();
      generated = true;
    }
    settings.push({
      name,
      value,
      secret,
      generated,
      derived: Boolean(derive),
      required: variable.required || Boolean(kit?.required?.includes(name)),
      publishedDefault: secret ? null : variable.default || null,
    });
  }
  const filled = resolveTemplates(kit, new Map(settings.map((s) => [s.name, s.value])));
  for (const setting of settings) setting.value = filled.get(setting.name) ?? null;
  return settings;
}

/** What the owner sees: secret values are replaced by whether they are set. */
export function publicSetting(setting: Pick<Setting, "name" | "secret" | "generated" | "required" | "publishedDefault"> & { value: string | null; derived?: boolean }) {
  return {
    name: setting.name,
    secret: setting.secret,
    generated: setting.generated,
    derived: setting.derived ?? false,
    required: setting.required,
    set: setting.value !== null && setting.value !== "",
    value: setting.secret ? undefined : setting.value,
    publishedDefault: setting.publishedDefault,
  };
}
