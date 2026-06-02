"""Sub-router de listado de recibos de sueldo."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from ...access import require_any_permission, user_has
from ...auth import require_current_user
from ...db import db_session
from ...models.auth import User
from ...models.employees import Employee, PayrollReceipt
from ...users import CurrentUser
from . import PayrollReceiptListResponse, _UserLookup, _receipt_to_out


router = APIRouter(tags=["payroll"])


@router.get("/receipts", response_model=PayrollReceiptListResponse)
def list_receipts(
    user: Annotated[CurrentUser, Depends(require_current_user)],
    scope: str = Query(default="auto"),
    status: str = Query(default=""),
    q: str = Query(default=""),
    period_year: int | None = None,
    period_month: int | None = None,
    limit: int = Query(default=100, ge=1, le=300),
):
    require_any_permission(
        user,
        ["payroll_receipts.view_own", "payroll_receipts.view_all"],
        detail="No tenes permiso para esta seccion",
    )
    with db_session() as session:
        stmt = (
            select(PayrollReceipt)
            .join(Employee, PayrollReceipt.employee_id == Employee.id)
            .outerjoin(User, Employee.user_id == User.id)
            .options(selectinload(PayrollReceipt.employee).selectinload(Employee.user))
        )
        show_all = user_has(user, "payroll_receipts.view_all") and scope in {"auto", "all"}
        if not show_all:
            stmt = stmt.where(User.username == user.username)
        if status:
            stmt = stmt.where(PayrollReceipt.status == status)
        if period_year:
            stmt = stmt.where(PayrollReceipt.period_year == int(period_year))
        if period_month:
            stmt = stmt.where(PayrollReceipt.period_month == int(period_month))
        if q.strip():
            text = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    Employee.display_name.ilike(text),
                    Employee.first_name.ilike(text),
                    Employee.last_name.ilike(text),
                    Employee.dni.ilike(text),
                    PayrollReceipt.file_name.ilike(text),
                    User.username.ilike(text),
                )
            )
        stmt = stmt.order_by(
            PayrollReceipt.period_year.desc(),
            PayrollReceipt.period_month.desc(),
            PayrollReceipt.created_at.desc(),
            PayrollReceipt.id.desc(),
        ).limit(limit)
        receipts = session.scalars(stmt).unique().all()
        lookup = _UserLookup(session)
        items = [_receipt_to_out(receipt, lookup) for receipt in receipts]

    return PayrollReceiptListResponse(
        items=items,
        total=len(items),
        pending=sum(1 for item in items if item.status in {"pendiente", "visto"}),
        signed=sum(1 for item in items if item.status == "firmado_conforme"),
        observed=sum(1 for item in items if item.status == "observado"),
    )

