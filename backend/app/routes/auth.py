"""Authentication routes.

Endpoints:
- POST /register: create a user + return a session token
- POST /login: validate credentials + return a session token
- GET /me: return the current user for a Bearer token

Auth tokens are stored server-side as hashed sessions (see `app/services/auth_service.py`).
"""

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.auth import (
    AuthResponse,
    DeleteAccountRequest,
    LoginRequest,
    RegisterRequest,
    UpdateAvatarRequest,
    UpdatePasswordRequest,
    UpdateUsernameRequest,
    UserRead,
)
from app.services.auth_service import (
    delete_user,
    get_user_by_token,
    login_user,
    register_user,
    update_avatar,
    update_password,
    update_username,
)

router = APIRouter()


def _auth_response(message: str, token: str, user) -> AuthResponse:
    """Build a consistent AuthResponse payload from ORM objects."""
    return {
        "message": message,
        "token": token,
        "user": UserRead.model_validate(user).model_dump(),
    }


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user and create a session token."""
    user, token = await register_user(db, payload)
    return _auth_response("Registration successful.", token, user)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate a user and create a new session token."""
    user, token = await login_user(db, payload)
    return _auth_response("Login successful.", token, user)


def _require_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return authorization.removeprefix("Bearer ").strip()


@router.get("/me", response_model=UserRead)
async def me(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """Return the current user for the provided Bearer token."""
    token = _require_token(authorization)
    user = await get_user_by_token(db, token)
    return UserRead.model_validate(user).model_dump()


@router.put("/me/username", response_model=UserRead)
async def change_username(
    payload: UpdateUsernameRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Update the authenticated user's username."""
    token = _require_token(authorization)
    user = await get_user_by_token(db, token)
    updated = await update_username(db, user, payload.new_username, payload.password)
    return UserRead.model_validate(updated).model_dump()


@router.put("/me/password", status_code=204)
async def change_password(
    payload: UpdatePasswordRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Update the authenticated user's password."""
    token = _require_token(authorization)
    user = await get_user_by_token(db, token)
    await update_password(db, user, payload.current_password, payload.new_password)


@router.put("/me/avatar", response_model=UserRead)
async def change_avatar(
    payload: UpdateAvatarRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Update the authenticated user's avatar (base64 data URL)."""
    token = _require_token(authorization)
    user = await get_user_by_token(db, token)
    updated = await update_avatar(db, user, payload.avatar)
    return UserRead.model_validate(updated).model_dump()


@router.delete("/me", status_code=204)
async def delete_account(
    payload: DeleteAccountRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete the authenticated user's account."""
    token = _require_token(authorization)
    user = await get_user_by_token(db, token)
    await delete_user(db, user, payload.password)
