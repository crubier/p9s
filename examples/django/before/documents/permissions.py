"""Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
shares of documents with the user"""

from django.db.models import Q

from .models import Document, DocumentShare, Project, ProjectShare, TeamMember

bits_of = {"viewer": {"read"}, "editor": {"read", "write"}, "owner": {"read", "write", "delete"}}


def teams_of(user_id):
    return TeamMember.objects.filter(user_id=user_id).values("team_id")


def project_bits(user_id, project_id):
    shares = ProjectShare.objects.filter(project_id=project_id, team_id__in=teams_of(user_id)).values_list("access", flat=True)
    return {bit for access in shares for bit in bits_of[access]}


def document_bits(user_id, document_id):
    """The bits of the user on the document, or None when there is no such document"""
    project_id = Document.objects.filter(id=document_id).values_list("project_id", flat=True).first()
    if project_id is None:
        return None
    share = DocumentShare.objects.filter(document_id=document_id, user_id=user_id).values_list("access", flat=True).first()
    return project_bits(user_id, project_id) | (bits_of[share] if share else set())


# Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects or
# shared with them
def readable_project_ids(user_id):
    return ProjectShare.objects.filter(team_id__in=teams_of(user_id)).values("project_id")


def readable_projects(user_id):
    return Project.objects.filter(id__in=readable_project_ids(user_id)).order_by("id")


def readable_documents(user_id):
    shared = DocumentShare.objects.filter(user_id=user_id).values("document_id")
    return Document.objects.filter(Q(project_id__in=readable_project_ids(user_id)) | Q(id__in=shared)).order_by("id")
