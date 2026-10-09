from types import SimpleNamespace

import pytest

from .conftest import configure_django, needs_database

pytestmark = needs_database


@pytest.fixture(scope="module")
def django_setup(database, tmp_path_factory):
    configure_django(tmp_path_factory.mktemp("django"))
    yield


def user_id_of(request):
    return request.headers.get("x-user-id")


def who():
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("select current_user, current_setting('app.user_id', true)")
        return cursor.fetchone()


def test_as_user(django_setup):
    from p9s.django import as_user

    with as_user(7):
        assert who() == ("p9s_python_user", "7")
    assert who()[0] != "p9s_python_user"


def test_a_refused_write_is_refused(django_setup):
    from django.db import DatabaseError, connection

    from p9s import is_refused
    from p9s.django import as_user

    with pytest.raises(DatabaseError) as raised:
        with as_user(7):
            with connection.cursor() as cursor:
                cursor.execute("insert into p9s_python_note (body) values ('refused')")
    assert is_refused(raised.value)


def test_the_decorator_and_the_middleware_act_as_the_user_of_the_request(django_setup):
    from p9s.django import P9sMiddleware, as_request_user

    request = SimpleNamespace(headers={"x-user-id": "42"})
    assert as_request_user(lambda request: who())(request) == ("p9s_python_user", "42")
    assert P9sMiddleware(lambda request: who())(request) == ("p9s_python_user", "42")
    assert who()[0] != "p9s_python_user"
