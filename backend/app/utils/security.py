from __future__ import annotations

import hashlib
import hmac
import secrets

HASH_ITERATIONS = 210_000
SALT_BYTES = 16
TOKEN_BYTES = 32


def hash_password(password: str, salt: str | None = None) -> str:
    if salt is None:
        salt = secrets.token_hex(SALT_BYTES)
    derived_key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        HASH_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt}${derived_key}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt, derived_key = stored_hash.split("$")
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    test_hash = hash_password(password, salt)
    try:
        _, _, _, test_derived_key = test_hash.split("$")
    except ValueError:
        return False

    return hmac.compare_digest(test_derived_key, derived_key)


def generate_auth_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_auth_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
