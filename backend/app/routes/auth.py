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
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest, UserRead
from app.services.auth_service import get_user_by_token, login_user, register_user

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


@router.get("/me", response_model=UserRead)
async def me(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """Return the current user for the provided Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    token = authorization.removeprefix("Bearer ").strip()
    user = await get_user_by_token(db, token)
    return UserRead.model_validate(user).model_dump()
