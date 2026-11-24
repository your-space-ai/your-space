// Account rules for the owner's name and username (FR-003; plan "Settled Values"). The owner gives no
// email: nothing sends one and nothing verifies one (decision 2026-11-23, Alpha scope).
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "../auth.ts";

export const NAME_MAX_LENGTH = 100;

/**
 * Better Auth's user table needs an email, so the owner's account holds this reserved address.
 * `.invalid` can never receive mail (RFC 2606), and the address is never shown or verified.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "users.invalid";

export function placeholderEmail(username: string): string {
  return `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

// The username plugin's characters, with each `.` between two other characters: the placeholder
// email is built from the username, and Better Auth refuses an address with a leading, trailing or
// doubled dot.
const USERNAME_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface OwnerInput {
  name: string;
  username: string;
}

export type FieldErrors = Partial<Record<keyof OwnerInput, string>>;

export function validateOwnerInput(input: {
  name?: string;
  username?: string;
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
  else if (!USERNAME_PATTERN.test(username))
    fields.username = "Use only letters, digits, _ and . in a username, with each . between other characters.";

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { name, username } };
}
