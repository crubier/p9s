"""Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
shares of documents with the user"""

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Document, DocumentShare, Project, ProjectShare, TeamMember

bits_of = {"viewer": {"read"}, "editor": {"read", "write"}, "owner": {"read", "write", "delete"}}


async def project_bits(session: AsyncSession, user_id: int, project_id: int) -> set[str]:
    shares = await session.scalars(
        select(ProjectShare.access)
        .join(TeamMember, TeamMember.team_id == ProjectShare.team_id)
        .where(TeamMember.user_id == user_id, ProjectShare.project_id == project_id)
    )
    return {bit for access in shares for bit in bits_of[access]}


async def document_bits(session: AsyncSession, user_id: int, document_id: int) -> set[str] | None:
    """The bits of the user on the document, or None when there is no such document"""
    project_id = await session.scalar(select(Document.project_id).where(Document.id == document_id))
    if project_id is None:
        return None
    share = await session.scalar(
        select(DocumentShare.access).where(DocumentShare.document_id == document_id, DocumentShare.user_id == user_id)
    )
    return await project_bits(session, user_id, project_id) | (bits_of[share] if share else set())


def shared_with_teams(user_id: int, project_id):
    return exists(
        select(ProjectShare.project_id)
        .join(TeamMember, TeamMember.team_id == ProjectShare.team_id)
        .where(ProjectShare.project_id == project_id, TeamMember.user_id == user_id)
    )


# Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects or
# shared with them
async def readable_projects(session: AsyncSession, user_id: int):
    return await session.execute(select(Project.id, Project.name).where(shared_with_teams(user_id, Project.id)).order_by(Project.id))


async def readable_documents(session: AsyncSession, user_id: int):
    return await session.execute(
        select(Document.id, Document.project_id, Document.title)
        .where(
            or_(
                shared_with_teams(user_id, Document.project_id),
                exists(select(DocumentShare.document_id).where(DocumentShare.document_id == Document.id, DocumentShare.user_id == user_id)),
            )
        )
        .order_by(Document.id)
    )
