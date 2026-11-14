// App settings and secrets (component F, FR-006, FR-018). Values are encrypted at rest with a key
// derived from the auth secret, and secret values are never returned by any route or command.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Kit } from "../db/schema.ts";

function key(authSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret, "your-space", "app-settings", 32));
}

export function encrypt(authSecret: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(authSecret), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(authSecret: string, stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unknown setting format.");
  const decipher = createDecipheriv("aes-256-gcm", key(authSecret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const SECRET_NAME = /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|(^|_)KEY($|_)|API_?KEY|ENCRYPTION/i;

/** Settings whose names say they hold a secret are never shown. */
export function looksSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

export function generateValue(options: { bytes?: number; encoding?: "hex" | "base64url" } = {}): string {
  return randomBytes(options.bytes ?? 32).toString(options.encoding ?? "base64url");
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
 * The settings an app's file reads, with values Your Space generates or works out. A published
 * default is never used for a secret: the kit says which values to generate, and without a kit any
 * setting that looks secret and has a published default gets a generated value (spec Q3).
 */
export function buildSettings(variables: Variable[], kit: Kit | null, address: AppAddress): Setting[] {
  const names = new Set(variables.map((v) => v.name));
  for (const name of Object.keys(kit?.generate ?? {})) names.add(name);
  for (const name of Object.keys(kit?.derive ?? {})) names.add(name);
  for (const name of Object.keys(kit?.set ?? {})) names.add(name);
  const byName = new Map(variables.map((v) => [v.name, v]));
  const settings: Setting[] = [];
  for (const name of [...names].sort()) {
    const variable = byName.get(name) ?? { name, required: false, default: "" };
    const derive = kit?.derive?.[name];
    const generate = kit?.generate?.[name];
    const secret = Boolean(generate) || Boolean(kit?.secrets?.includes(name)) || looksSecret(name);
    let value: string | null = null;
    let generated = false;
    if (derive) {
      value = derive === "app_origin" ? address.origin : address.host;
    } else if (generate) {
      value = generateValue(generate);
      generated = true;
    } else if (kit?.set?.[name] !== undefined) {
      value = kit.set[name]!;
    } else if (!kit && secret && variable.default) {
      value = generateValue();
      generated = true;
    }
    settings.push({
      name,
      value,
      secret,
      generated,
      derived: Boolean(derive),
      required: variable.required,
      publishedDefault: secret ? null : variable.default || null,
    });
  }
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
