from __future__ import annotations

"""Authentication service.

Responsibilities:
- Register users (hash password)
- Login users (verify password)
- Create/retrieve server-side sessions identified by a random token

Important design choice: session tokens are stored hashed in the DB (AuthSession.token_hash)
so raw tokens are only ever shown once to the client.
"""

from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.auth import AuthSession, User
from app.schemas.auth import LoginRequest, RegisterRequest
from app.utils.security import (
    generate_auth_token,
    hash_auth_token,
    hash_password,
    verify_password,
)

SESSION_DAYS = 7


def _validate_avatar_size(avatar: str | None) -> None:
    """Reject avatars that exceed the configured size budget (default 1 MB)."""
    if avatar is None:
        return
    max_bytes = get_settings().max_avatar_size_kb * 1024
    if len(avatar.encode("utf-8")) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Avatar exceeds the {get_settings().max_avatar_size_kb} KB size limit.",
        )


async def _create_session(db: AsyncSession, user: User) -> str:
    """Create an AuthSession row and return the *raw* token for the client."""
    token = generate_auth_token()
    session = AuthSession(
        user_id=user.id,
        token_hash=hash_auth_token(token),
        expires_at=datetime.utcnow() + timedelta(days=SESSION_DAYS),
    )
    db.add(session)
    await db.flush()
    return token


async def register_user(db: AsyncSession, payload: RegisterRequest) -> tuple[User, str]:
    """Create a new user account and return (user, session_token)."""
    username = payload.username.strip()
    result = await db.execute(select(User).where(User.username == username))
    existing_user = result.scalar_one_or_none()
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already taken.",
        )

    user = User(
        username=username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    await db.flush()
    token = await _create_session(db, user)
    await db.commit()
    await db.refresh(user)
    return user, token


async def login_user(db: AsyncSession, payload: LoginRequest) -> tuple[User, str]:
    """Validate credentials and return (user, new_session_token)."""
    username = payload.username.strip()
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    token = await _create_session(db, user)
    await db.commit()
    return user, token


async def update_username(db: AsyncSession, user: User, new_username: str, password: str) -> User:
    """Change a user's username after verifying their current password."""
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password.")

    new_username = new_username.strip()
    if len(new_username) < 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username must be at least 3 characters.")

    result = await db.execute(select(User).where(User.username == new_username, User.id != user.id))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already taken.")

    user.username = new_username
    await db.commit()
    await db.refresh(user)
    return user


async def update_password(db: AsyncSession, user: User, current_password: str, new_password: str) -> None:
    """Change a user's password and revoke all existing sessions.

    Force re-login on every other device by stamping `revoked_at` on every active
    AuthSession row for this user.
    """
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect current password.")

    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 8 characters.")

    user.password_hash = hash_password(new_password)

    result = await db.execute(select(AuthSession).where(AuthSession.user_id == user.id))
    sessions = result.scalars().all()
    now = datetime.utcnow()
    for session in sessions:
        session.revoked_at = now

    await db.commit()


async def update_avatar(db: AsyncSession, user: User, avatar: str | None) -> User:
    """Update a user's avatar (base64 data URL or None to clear).

    Rejects payloads larger than `MAX_AVATAR_SIZE_KB` (default 1024 KB) to keep
    the avatar TEXT column from being abused as unbounded storage.
    """
    _validate_avatar_size(avatar)
    user.avatar = avatar
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user: User, password: str) -> None:
    """Permanently delete a user account and explicitly cascade their datasets.

    The Dataset ↔ User relationship has no `cascade="all, delete-orphan"` declared
    on the User side, so we iterate and delete each dataset (which DOES cascade
    to its versions/actions) before removing the user row itself.
    """
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password.")

    from app.models.dataset import Dataset
    from app.services.dataset_service import delete_owned_dataset

    result = await db.execute(select(Dataset).where(Dataset.user_id == user.id))
    datasets = result.scalars().all()
    for dataset in datasets:
        await delete_owned_dataset(db, dataset)

    await db.delete(user)
    await db.commit()


async def get_user_by_token(db: AsyncSession, token: str) -> User:
    """Resolve a Bearer token into a User, enforcing session expiry/revocation."""
    token_hash = hash_auth_token(token)
    result = await db.execute(select(AuthSession).where(AuthSession.token_hash == token_hash))
    auth_session = result.scalar_one_or_none()
    if auth_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )

    now = datetime.utcnow()
    if auth_session.revoked_at is not None or auth_session.expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )

    user = await db.get(User, auth_session.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )
    return user
