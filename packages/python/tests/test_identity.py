import pytest

from p9s import Identity, is_refused

from .conftest import CONFIG


def test_settings_take_the_first_user_role_and_the_setting():
    users = Identity(CONFIG)
    assert users.role == "p9s_python_user"
    assert users.settings(7) == [("role", "p9s_python_user"), ("app.user_id", "7")]
    assert users.settings(None) == [("role", "p9s_python_user"), ("app.user_id", "")]
    assert users.settings("alice", role="p9s_python_writer", settings={"app.audit": True, "app.reason": None}) == [
        ("role", "p9s_python_writer"),
        ("app.user_id", "alice"),
        ("app.audit", "on"),
        ("app.reason", ""),
    ]


def test_the_statement_has_named_parameters():
    text, params = Identity(CONFIG).statement(7)
    assert text == "select set_config(%(name_0)s, %(value_0)s, true), set_config(%(name_1)s, %(value_1)s, true)"
    assert params == {"name_0": "role", "value_0": "p9s_python_user", "name_1": "app.user_id", "value_1": "7"}


def test_a_claim_sets_json_claims():
    config = {"engine": {"users": ["authenticated"], "authentication": {"setting": "request.jwt.claims", "claim": "sub"}}}
    assert Identity(config).settings(7)[1] == ("request.jwt.claims", '{"sub":"7"}')
    assert Identity(config, setting="app.user_id").settings(7)[1] == ("app.user_id", "7")


def test_from_file(config_path):
    assert Identity.from_file(config_path).setting == "app.user_id"


def test_roles_and_settings_are_checked():
    with pytest.raises(ValueError, match="not a role"):
        Identity(CONFIG).settings(7, role="postgres")
    with pytest.raises(ValueError, match="engine.users is empty"):
        Identity({"engine": {"authentication": {"setting": "app.user_id"}}})
    with pytest.raises(ValueError, match="engine.authentication.setting"):
        Identity({"engine": {"users": ["app_user"]}})


class Wrapper(Exception):
    def __init__(self, orig=None, cause=None):
        super().__init__("wrapped")
        self.orig = orig
        self.__cause__ = cause


class PostgresError(Exception):
    def __init__(self, sqlstate=None, pgcode=None):
        super().__init__("postgres")
        self.sqlstate = sqlstate
        self.pgcode = pgcode


def test_is_refused_looks_through_wrappers():
    assert is_refused(PostgresError(sqlstate="42501"))
    assert is_refused(PostgresError(pgcode="42501"))
    assert is_refused(Wrapper(orig=PostgresError(sqlstate="42501")))
    assert is_refused(Wrapper(cause=PostgresError(sqlstate="42501")))
    assert not is_refused(Wrapper(orig=PostgresError(sqlstate="23505")))
    assert not is_refused(ValueError("nope"))
    assert not is_refused(None)
