from django.http import JsonResponse


def user_id_of(request):
    """The id of the user of the request, from its header, or None"""
    header = request.headers.get("x-user-id", "")
    return int(header) if header.lstrip("-").isdigit() else None


class UserFromHeader:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.user_id = user_id_of(request)
        if request.user_id is None and request.path != "/health":
            return JsonResponse({"error": "unauthorized"}, status=401)
        return self.get_response(request)
