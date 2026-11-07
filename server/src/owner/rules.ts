// Account rules for the owner's name and email (FR-003; plan "Settled Values").

export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

// The browser's own rule for <input type="email"> (WHATWG HTML), plus a dot in the domain.
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface OwnerInput {
  name: string;
  email: string;
}

export type FieldErrors = Partial<Record<keyof OwnerInput, string>>;

export function validateOwnerInput(input: Partial<OwnerInput>): { ok: true; value: OwnerInput } | { ok: false; fields: FieldErrors } {
  const fields: FieldErrors = {};

  const name = (input.name ?? "").trim();
  if (name.length === 0) fields.name = "Enter a name.";
  else if ([...name].length > NAME_MAX_LENGTH) fields.name = `Use at most ${NAME_MAX_LENGTH} characters.`;
  else if (CONTROL_CHARACTERS.test(name)) fields.name = "A name can't contain control characters.";

  const email = (input.email ?? "").trim().toLowerCase();
  if (email.length === 0) fields.email = "Enter an email address.";
  else if (email.length > EMAIL_MAX_LENGTH) fields.email = `Use at most ${EMAIL_MAX_LENGTH} characters.`;
  else if (!EMAIL_PATTERN.test(email)) fields.email = "Not a valid email address.";

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { name, email } };
}
