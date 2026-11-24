// App settings and secrets (component F, FR-006, FR-018). Values are encrypted at rest with the data
// key (spec 009), and secret values are never returned by any route or command. Values written
// before the data key existed are "v1", encrypted with a key derived from the auth secret; the
// server moves them onto the data key when it starts (keys.ts).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { EnvSource, Kit, StoredKit } from "../db/schema.ts";

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

export function generateValue(options: { bytes?: number; encoding?: "hex" | "base64url" } = {}): string {
  return randomBytes(options.bytes ?? 32).toString(options.encoding ?? "base64url");
}

/** `${NAME}` in a kit's derive template: another variable in the kit's env. */
export const TEMPLATE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function templateNames(template: string): string[] {
  return [...template.matchAll(TEMPLATE_REFERENCE)].map((m) => m[1]!);
}

/**
 * A kit's `env`. A kit stored before `env` (2026-11-23) named its values in `generate`, `derive` and
 * `set`, and the settings shown only as set in `secrets`, which the owner could give.
 */
export function kitEnv(kit: StoredKit | null | undefined): Record<string, EnvSource> {
  if (!kit) return {};
  if (kit.env) return kit.env;
  const env: Record<string, EnvSource> = {};
  for (const name of kit.secrets ?? []) env[name] = { ask: "optional", secret: true };
  for (const [name, value] of Object.entries(kit.set ?? {})) env[name] = value;
  for (const [name, o] of Object.entries(kit.generate ?? {})) env[name] = { generate: { bytes: o.bytes ?? 32, encoding: o.encoding ?? "base64url" } };
  for (const [name, derive] of Object.entries(kit.derive ?? {})) env[name] = { derive };
  return env;
}

/** A stored kit in the form a kit file parses to, so the two compare. */
export function withEnv(kit: StoredKit): Kit {
  const { generate, derive, set, secrets, ...rest } = kit;
  if (generate === undefined && derive === undefined && set === undefined && secrets === undefined) return rest;
  return { ...rest, env: kitEnv(kit) };
}

/** The template a variable is derived with, if it is one. */
export function templateOf(source: EnvSource | undefined): string | undefined {
  return typeof source === "object" && "derive" in source && typeof source.derive === "object" ? source.derive.template : undefined;
}

/** Whether Your Space works a variable out itself, so the owner can't change it. */
export function isDerived(env: Record<string, EnvSource>, name: string): boolean {
  const source = env[name];
  return typeof source === "object" && "derive" in source;
}

/** Whether the kit asks the owner for a variable the install needs. */
export function isAsked(env: Record<string, EnvSource>, name: string): boolean {
  const source = env[name];
  return typeof source === "object" && "ask" in source && source.ask === true;
}

/** Whether Your Space shows a variable only as set: generated, asked as a secret, or a template that uses one. */
export function isSecret(env: Record<string, EnvSource>, name: string): boolean {
  const source = env[name];
  if (typeof source !== "object") return false;
  if ("generate" in source) return true;
  if ("ask" in source) return source.secret;
  const template = templateOf(source);
  return template !== undefined && templateNames(template).some((ref) => ref !== name && isSecret(env, ref));
}

/**
 * Fills the kit's template variables from the current values of the variables they use. It runs
 * whenever the app's environment is built, so a changed password reaches the URL that contains it.
 * Values are inserted as they are; generated values are hex or base64url, so they are safe in URLs.
 */
export function resolveTemplates(env: Record<string, EnvSource>, values: Map<string, string | null>): Map<string, string | null> {
  const resolved = new Map(values);
  for (const [name, source] of Object.entries(env)) {
    const template = templateOf(source);
    if (template !== undefined) resolved.set(name, template.replace(TEMPLATE_REFERENCE, (_, ref: string) => values.get(ref) ?? ""));
  }
  return resolved;
}

/** A variable the app's file uses, as Compose lists it, and whether Compose had to leave it blank. */
export interface Variable {
  name: string;
  required: boolean;
  default: string;
  /** It had no value and no default, so Compose used a blank string. */
  unset?: boolean;
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
 * The app's settings: exactly its kit's `env`, with the values Your Space generates or works out
 * (decision 2026-11-23). Nothing comes from the app's file, and no name decides what is secret. Data
 * kept from a removed app was written with its settings then, so a setting kept from it keeps its
 * value, even an unset one, rather than one the kit generates or gives now.
 */
export function buildSettings(kit: Kit, address: AppAddress, previous: Map<string, string | null> = new Map()): Setting[] {
  const env = kitEnv(kit);
  const settings: Setting[] = [];
  for (const name of Object.keys(env).sort()) {
    const source = env[name]!;
    const kept = previous.get(name);
    let value: string | null = kept ?? null;
    let generated = false;
    if (typeof source === "string") {
      value = kept === undefined ? source : kept;
    } else if ("generate" in source) {
      // A kept value, even an unset one, stays: kept data was written with it. Only a new one is generated.
      value = kept === undefined ? generateValue(source.generate) : kept;
      generated = value !== null;
    } else if ("derive" in source) {
      // A template is filled below, once the variables it uses have values.
      value = typeof source.derive === "object" ? null : source.derive === "app_origin" ? address.origin : address.host;
    }
    settings.push({
      name,
      value,
      secret: isSecret(env, name),
      generated,
      derived: isDerived(env, name),
      required: isAsked(env, name),
      publishedDefault: null,
    });
  }
  const filled = resolveTemplates(env, new Map(settings.map((s) => [s.name, s.value])));
  for (const setting of settings) setting.value = filled.get(setting.name) ?? null;
  return settings;
}

/**
 * What the app's file says about its settings: one it requires with `${NAME:?…}` or `${NAME?…}` is
 * required, and one that isn't secret shows the file's default, which the app gets while it has no value.
 */
export function withFileDefaults(settings: Setting[], variables: Variable[]): void {
  for (const setting of settings) {
    const variable = variables.find((v) => v.name === setting.name);
    if (!variable) continue;
    if (variable.required) setting.required = true;
    if (!setting.secret && variable.default) setting.publishedDefault = variable.default;
  }
}

/**
 * The variables the app's file needs, with no default, that its kit doesn't define: a review refuses
 * the app until the kit does (decision 2026-11-23).
 */
export function undefinedVariables(variables: Variable[], env: Record<string, EnvSource>): string[] {
  return variables.filter((v) => (v.required || v.unset) && !Object.hasOwn(env, v.name)).map((v) => v.name).sort();
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
