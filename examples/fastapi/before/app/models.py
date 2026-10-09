from typing import Literal

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Access = Literal["viewer", "editor", "owner"]


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)


class TeamMember(Base):
    __tablename__ = "team_members"
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]


class ProjectShare(Base):
    __tablename__ = "project_shares"
    __table_args__ = (CheckConstraint("access in ('viewer', 'editor', 'owner')", name="project_shares_access_check"),)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    access: Mapped[str] = mapped_column(String)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str]
    body: Mapped[str] = mapped_column(default="", server_default="")

    def json(self) -> dict:
        return {"id": self.id, "project_id": self.project_id, "title": self.title, "body": self.body}


class DocumentShare(Base):
    __tablename__ = "document_shares"
    __table_args__ = (CheckConstraint("access in ('viewer', 'editor')", name="document_shares_access_check"),)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    access: Mapped[str] = mapped_column(String)
