export const minimumPasswordLength = 8;
export const maximumPasswordBytes = 1024;
export const maximumUsernameLength = 128;
export const maximumUsernameBytes = 256;

export function validatedUsername(value: unknown) {
  const username = String(value ?? "").trim();
  if (
    !username ||
    username.length > maximumUsernameBytes ||
    Array.from(username).length > maximumUsernameLength ||
    Buffer.byteLength(username, "utf8") > maximumUsernameBytes ||
    /[\u0000-\u001f\u007f]/.test(username)
  ) {
    return null;
  }
  return username;
}

export function passwordIsWithinBounds(password: string) {
  const bytes = Buffer.byteLength(password, "utf8");
  return (
    Array.from(password).length >= minimumPasswordLength &&
    bytes <= maximumPasswordBytes
  );
}
