from django.db import models

ACCESS = [("viewer", "viewer"), ("editor", "editor"), ("owner", "owner")]


class User(models.Model):
    name = models.TextField(unique=True)

    class Meta:
        db_table = "users"


class Team(models.Model):
    name = models.TextField(unique=True)

    class Meta:
        db_table = "teams"


class TeamMember(models.Model):
    pk = models.CompositePrimaryKey("team_id", "user_id")
    team = models.ForeignKey(Team, on_delete=models.DB_CASCADE)
    user = models.ForeignKey(User, on_delete=models.DB_CASCADE)

    class Meta:
        db_table = "team_members"


class Project(models.Model):
    name = models.TextField()

    class Meta:
        db_table = "projects"


class ProjectShare(models.Model):
    pk = models.CompositePrimaryKey("project_id", "team_id")
    project = models.ForeignKey(Project, on_delete=models.DB_CASCADE)
    team = models.ForeignKey(Team, on_delete=models.DB_CASCADE)
    access = models.TextField(choices=ACCESS)

    class Meta:
        db_table = "project_shares"
        constraints = [models.CheckConstraint(condition=models.Q(access__in=["viewer", "editor", "owner"]), name="project_shares_access_check")]


class Document(models.Model):
    project = models.ForeignKey(Project, on_delete=models.DB_CASCADE)
    title = models.TextField()
    body = models.TextField(default="", db_default="")

    class Meta:
        db_table = "documents"

    def json(self):
        return {"id": self.id, "project_id": self.project_id, "title": self.title, "body": self.body}


class DocumentShare(models.Model):
    pk = models.CompositePrimaryKey("document_id", "user_id")
    document = models.ForeignKey(Document, on_delete=models.DB_CASCADE)
    user = models.ForeignKey(User, on_delete=models.DB_CASCADE)
    access = models.TextField(choices=ACCESS[:2])

    class Meta:
        db_table = "document_shares"
        constraints = [models.CheckConstraint(condition=models.Q(access__in=["viewer", "editor"]), name="document_shares_access_check")]
