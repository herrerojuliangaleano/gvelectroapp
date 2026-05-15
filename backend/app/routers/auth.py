from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from ..audit import audit
from ..auth import authenticate, create_token, require_current_user
from ..schemas import ChangePasswordRequest, LoginRequest, LoginResponse, MeResponse
from ..users import CurrentUser, get_current_user, set_own_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _login_response(user: CurrentUser) -> LoginResponse:
    return LoginResponse(token=create_token(user), **user.public())


@router.post("/login", response_model=LoginResponse)
def login(data: LoginRequest) -> LoginResponse:
    user = authenticate(data.username, data.password)
    if not user:
        audit("auth.login_failed", user=None, resource_type="user", resource_id=data.username, status="error", message="Usuario o contraseña incorrectos")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario o contraseña incorrectos")
    audit("auth.login", user=user, resource_type="user", resource_id=user.username, message="Inicio de sesión")
    return _login_response(user)


@router.get("/me", response_model=MeResponse)
def me(user: Annotated[CurrentUser, Depends(require_current_user)]):
    return MeResponse(**user.public())


@router.post("/change-password", response_model=LoginResponse)
def change_password(data: ChangePasswordRequest, user: Annotated[CurrentUser, Depends(require_current_user)]) -> LoginResponse:
    try:
        record = set_own_password(user.username, data.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    updated = get_current_user(record.username)
    if not updated:
        raise HTTPException(status_code=400, detail="No se pudo actualizar la contraseña")
    audit("auth.password_set", user=updated, resource_type="user", resource_id=updated.username, message="Contraseña creada o actualizada")
    return _login_response(updated)
