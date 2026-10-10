import json

from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .models import Document, DocumentShare
from .permissions import bits_of, document_bits, project_bits, readable_documents, readable_projects

not_found = {"error": "not found"}
forbidden = {"error": "forbidden"}


def health(request):
    return HttpResponse("ok", content_type="text/plain")


def projects(request):
    return JsonResponse(list(readable_projects(request.user_id).values("id", "name")), safe=False)


@require_http_methods(["GET", "POST"])
def documents(request):
    if request.method == "POST":
        data = json.loads(request.body)
        if "write" not in project_bits(request.user_id, data["project_id"]):
            return JsonResponse(forbidden, status=403)
        document = Document.objects.create(project_id=data["project_id"], title=data["title"], body=data.get("body", ""))
        return JsonResponse(document.json(), status=201)
    return JsonResponse(list(readable_documents(request.user_id).values("id", "project_id", "title")), safe=False)


@require_http_methods(["GET", "PATCH", "DELETE"])
def document(request, id):
    bits = document_bits(request.user_id, id)
    if not bits or "read" not in bits:
        return JsonResponse(not_found, status=404)
    if request.method == "PATCH":
        if "write" not in bits:
            return JsonResponse(forbidden, status=403)
        changes = {name: value for name, value in json.loads(request.body).items() if name in ("title", "body")}
        Document.objects.filter(id=id).update(**changes)
    elif request.method == "DELETE":
        if "delete" not in bits:
            return JsonResponse(forbidden, status=403)
        Document.objects.filter(id=id).delete()
        return HttpResponse(status=204)
    return JsonResponse(Document.objects.get(id=id).json())


@require_http_methods(["PUT"])
def share(request, id, user_id):
    access = json.loads(request.body)["access"]
    bits = document_bits(request.user_id, id)
    if not bits or "read" not in bits:
        return JsonResponse(not_found, status=404)
    previous = DocumentShare.objects.filter(document_id=id, user_id=user_id).values_list("access", flat=True).first()
    if not bits_of[access] <= bits or (previous and not bits_of[previous] <= bits):
        return JsonResponse(forbidden, status=403)
    DocumentShare.objects.update_or_create(document_id=id, user_id=user_id, defaults={"access": access})
    return HttpResponse(status=204)
