from django.urls import path

from documents import views

urlpatterns = [
    path("health", views.health),
    path("projects", views.projects),
    path("documents", views.documents),
    path("documents/<int:id>", views.document),
    path("documents/<int:id>/shares/<int:user_id>", views.share),
]
