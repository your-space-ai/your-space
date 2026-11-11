// Account rules for the owner's name, username and optional email (FR-003; plan "Settled Values").
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "../auth.ts";

export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

/**
 * Better Auth's user table needs an email, so an owner who gives none gets this reserved address.
 * `.invalid` can never receive mail (RFC 2606), and the address is never shown or verified.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "users.invalid";

export function placeholderEmail(username: string): string {
  return `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** The owner's own email, or null when the account holds only the placeholder. */
export function ownEmail(email: string): string | null {
  return isPlaceholderEmail(email) ? null : email;
}

// The rule Better Auth applies when it creates the account (zod's `email()`), so an address this
// accepts is never refused later: letters, digits, and _ ' + - in dot-separated parts, then a
// domain ending in a top-level domain of 2 or more letters.
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
// The username plugin's own rule, so a username this accepts is never refused later.
const USERNAME_PATTERN = /^[a-z0-9_.]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface OwnerInput {
  name: string;
  username: string;
  /** Optional. Stays unverified: nothing here proves the owner controls the mailbox. */
  email: string | null;
}

export type FieldErrors = Partial<Record<keyof OwnerInput, string>>;

export function validateOwnerInput(input: {
  name?: string;
  username?: string;
  email?: string;
}): { ok: true; value: OwnerInput } | { ok: false; fields: FieldErrors } {
  const fields: FieldErrors = {};

  const name = (input.name ?? "").trim();
  if (name.length === 0) fields.name = "Enter a name.";
  else if ([...name].length > NAME_MAX_LENGTH) fields.name = `Use at most ${NAME_MAX_LENGTH} characters.`;
  else if (CONTROL_CHARACTERS.test(name)) fields.name = "A name can't contain control characters.";

  // Compared without case, so it is stored in lower case.
  const username = (input.username ?? "").trim().toLowerCase();
  if (username.length === 0) fields.username = "Enter a username.";
  else if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH)
    fields.username = `Use ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters.`;
  else if (!USERNAME_PATTERN.test(username)) fields.username = "Use only letters, digits, _ and . in a username.";

  let email: string | null = null;
  if (input.email !== undefined) {
    email = input.email.trim().toLowerCase();
    if (email.length === 0) fields.email = "Enter an email address, or leave out --email.";
    else if (email.length > EMAIL_MAX_LENGTH) fields.email = `Use at most ${EMAIL_MAX_LENGTH} characters.`;
    else if (!EMAIL_PATTERN.test(email)) fields.email = "Not a valid email address.";
    else if (isPlaceholderEmail(email)) fields.email = `Addresses at ${PLACEHOLDER_EMAIL_DOMAIN} can't receive mail.`;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { name, username, email } };
}
