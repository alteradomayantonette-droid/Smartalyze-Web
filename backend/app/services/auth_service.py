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

from app.models.auth import AuthSession, User
from app.schemas.auth import LoginRequest, RegisterRequest
from app.utils.security import (
    generate_auth_token,
    hash_auth_token,
    hash_password,
    verify_password,
)

SESSION_DAYS = 7


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
