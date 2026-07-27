import { hash, verify } from "@node-rs/argon2";

// argon2id with the parameters @node-rs recommends for interactive logins.
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    // A malformed hash should read as "wrong password", not crash the login.
    return false;
  }
}
