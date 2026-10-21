"""שכבת מסד הנתונים: SQLite דרך SQLAlchemy 2.x.

להחלפה ל-Postgres בעתיד: לשנות רק את DB_URL (או את משתנה הסביבה DATABASE_URL).
התקנה: pip install sqlalchemy pandas xlsxwriter
"""
from __future__ import annotations

import hashlib
import os
from datetime import date, datetime
from pathlib import Path

import pandas as pd
from sqlalchemy import (
    Date, DateTime, ForeignKey, String, Text, UniqueConstraint,
    create_engine, event, select,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker,
)

DB_URL = os.environ.get("DATABASE_URL", "sqlite:///forms.db")

STATUS_PENDING = "pending"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_VERIFIED = "verified"


class Base(DeclarativeBase):
    pass


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    forms: Mapped[list["Form"]] = relationship(back_populates="batch")


class Form(Base):
    __tablename__ = "forms"
    # אותו עמוד מאותו קובץ לא נכנס פעמיים
    __table_args__ = (UniqueConstraint("file_hash", "page_number", name="uq_file_page"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"))
    file_name: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    page_number: Mapped[int] = mapped_column(default=1)

    form_type: Mapped[str | None] = mapped_column(String(50))
    sender: Mapped[str | None] = mapped_column(String(100))
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    # מחרוזת ולא מספר: שומר אפסים מובילים
    id_number: Mapped[str | None] = mapped_column(String(20))
    received_date: Mapped[date | None] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(20), default=STATUS_NEEDS_REVIEW, index=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    exported_at: Mapped[datetime | None] = mapped_column(DateTime)

    batch: Mapped[Batch] = relationship(back_populates="forms")
    central_numbers: Mapped[list["CentralNumber"]] = relationship(
        cascade="all, delete-orphan", back_populates="form")
    commitment_numbers: Mapped[list["CommitmentNumber"]] = relationship(
        cascade="all, delete-orphan", back_populates="form")
    flags: Mapped[list["FieldFlag"]] = relationship(
        cascade="all, delete-orphan", back_populates="form")


class CentralNumber(Base):
    __tablename__ = "central_numbers"
    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    number: Mapped[str] = mapped_column(String(20), index=True)
    form: Mapped[Form] = relationship(back_populates="central_numbers")


class CommitmentNumber(Base):
    __tablename__ = "commitment_numbers"
    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    number: Mapped[str] = mapped_column(String(50))
    form: Mapped[Form] = relationship(back_populates="commitment_numbers")


class FieldFlag(Base):
    """שדה שסומן לבדיקה, והתיקון שנעשה בו. מקור למדידת טעויות."""
    __tablename__ = "field_flags"
    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    field_name: Mapped[str] = mapped_column(String(50))
    reason: Mapped[str | None] = mapped_column(Text)
    original_value: Mapped[str | None] = mapped_column(Text)
    corrected_value: Mapped[str | None] = mapped_column(Text)
    form: Mapped[Form] = relationship(back_populates="flags")


# ---------- חיבור ואתחול ----------

engine = create_engine(DB_URL)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    if DB_URL.startswith("sqlite"):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys = ON")
        cur.execute("PRAGMA journal_mode = WAL")
        cur.close()


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------- פעולות ----------

def create_batch(session: Session) -> Batch:
    batch = Batch()
    session.add(batch)
    session.flush()
    return batch


def save_extraction(session: Session, batch: Batch, *, file_name: str,
                    file_bytes: bytes, page_number: int, data: dict,
                    flags: list[dict] | None = None) -> Form | None:
    """שומר טופס שחולץ. מחזיר None אם העמוד הזה כבר קיים (העלאה כפולה).

    data: form_type, sender, first_name, last_name, id_number, received_date (date),
          central_numbers (list), commitment_numbers (list). הכול אופציונלי.
    flags: [{"field_name":..., "reason":..., "original_value":...}]
    """
    fh = file_hash(file_bytes)
    exists = session.scalar(select(Form.id).where(
        Form.file_hash == fh, Form.page_number == page_number))
    if exists:
        return None

    flags = flags or []
    form = Form(
        batch_id=batch.id, file_name=file_name, file_hash=fh, page_number=page_number,
        form_type=data.get("form_type"), sender=data.get("sender"),
        first_name=data.get("first_name"), last_name=data.get("last_name"),
        id_number=data.get("id_number"), received_date=data.get("received_date"),
        status=STATUS_NEEDS_REVIEW if flags else STATUS_PENDING,
    )
    form.central_numbers = [CentralNumber(number=n) for n in data.get("central_numbers", [])]
    form.commitment_numbers = [CommitmentNumber(number=n) for n in data.get("commitment_numbers", [])]
    form.flags = [FieldFlag(**f) for f in flags]
    session.add(form)
    session.flush()
    return form


def verify_form(session: Session, form_id: int, corrections: dict | None = None) -> Form:
    """מאשרת טופס אחרי בדיקה. corrections: {שם_שדה: ערך_מתוקן}."""
    form = session.get(Form, form_id)
    for field, value in (corrections or {}).items():
        old = getattr(form, field)
        if old != value:
            setattr(form, field, value)
            flag = next((f for f in form.flags if f.field_name == field), None)
            if flag is None:
                flag = FieldFlag(field_name=field, original_value=None if old is None else str(old))
                form.flags.append(flag)
            flag.corrected_value = None if value is None else str(value)
    form.status = STATUS_VERIFIED
    form.verified_at = datetime.now()
    session.flush()
    return form


def forms_dataframe(session: Session, *, only_unexported: bool = True,
                    batch_id: int | None = None) -> pd.DataFrame:
    q = select(Form).where(Form.status == STATUS_VERIFIED)
    if only_unexported:
        q = q.where(Form.exported_at.is_(None))
    if batch_id is not None:
        q = q.where(Form.batch_id == batch_id)
    rows = []
    for f in session.scalars(q.order_by(Form.id)):
        rows.append({
            "id": f.id,
            "שם פרטי": f.first_name,
            "שם משפחה": f.last_name,
            "ת.ז.": f.id_number,
            "מספר מרכזי": ", ".join(c.number for c in f.central_numbers),
            "תאריך קבלה": f.received_date,
            "גורם שולח": f.sender,
            "מספר התחייבות": ", ".join(c.number for c in f.commitment_numbers),
        })
    return pd.DataFrame(rows)


def export_to_excel(session: Session, path: str | Path, **kwargs) -> int:
    """מייצאת טפסים מאומתים שטרם יוצאו, ומסמנת אותם כמיוצאים. מחזיר כמה יוצאו."""
    df = forms_dataframe(session, **kwargs)
    if df.empty:
        return 0
    ids = df.pop("id").tolist()
    with pd.ExcelWriter(path, engine="xlsxwriter") as xw:
        df.to_excel(xw, index=False, sheet_name="התחייבויות")
        xw.sheets["התחייבויות"].right_to_left()
    now = datetime.now()
    for form in session.scalars(select(Form).where(Form.id.in_(ids))):
        form.exported_at = now
    session.flush()
    return len(ids)


def clear_all(session: Session) -> None:
    """מחיקת כל הנתונים (לפרטיות/איפוס)."""
    for model in (FieldFlag, CommitmentNumber, CentralNumber, Form, Batch):
        session.query(model).delete()


if __name__ == "__main__":
    # בדיקה מהירה: python db.py
    # כדי לא לגעת במסד האמיתי: DATABASE_URL=sqlite:///demo.db python db.py
    init_db()
    with SessionLocal.begin() as s:
        b = create_batch(s)
        f = save_extraction(
            s, b, file_name="demo.pdf", file_bytes=b"demo", page_number=1,
            data={"first_name": "נועה", "last_name": "כהן", "id_number": "208457316",
                  "received_date": date(2026, 10, 12), "central_numbers": ["457821", "457822"],
                  "commitment_numbers": ["68019452"]},
            flags=[{"field_name": "sender", "reason": "כתב יד לא ברור"}])
        print("נשמר:", f.id if f else "כבר קיים")
        if f:
            verify_form(s, f.id, {"sender": "כללית"})
        print("יוצאו:", export_to_excel(s, "demo_export.xlsx"))