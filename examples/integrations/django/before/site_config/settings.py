import os
from pathlib import Path
from urllib.parse import urlsplit

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("SECRET_KEY", "an example, not a secret")
DEBUG = False
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

INSTALLED_APPS = ["documents"]

# A real app signs users in with django.contrib.auth, this one reads the user from a header
MIDDLEWARE = ["documents.middleware.UserFromHeader"]

ROOT_URLCONF = "site_config.urls"
WSGI_APPLICATION = "site_config.wsgi.application"

_database = urlsplit(os.environ["DATABASE_URL"])
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": _database.path.lstrip("/"),
        "USER": _database.username or "",
        "PASSWORD": _database.password or "",
        "HOST": _database.hostname or "",
        "PORT": str(_database.port or ""),
        # Connections stay open between requests, rather than one for each
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
}

USE_TZ = True
