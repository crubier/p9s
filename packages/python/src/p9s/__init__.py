"""Act as a user of p9s from Python: every query of a transaction goes through the policies of p9s.

``p9s.sqlalchemy`` and ``p9s.django`` run transactions as a user, with the role and the setting of the config."""

from .identity import Identity, UserId, is_refused

__all__ = ["Identity", "UserId", "is_refused"]
