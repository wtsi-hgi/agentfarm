"""Application configuration using pydantic-settings."""

import getpass
from pathlib import Path

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Names of the SQLite database file and the markdown-mirror git repo directory,
# both located inside ``data_dir``. Later items (1.3 DB init, Phase 10 mirror)
# resolve their on-disk locations via ``Settings.db_path`` / ``Settings.mirror_dir``.
DB_FILENAME = "agentfarm.db"
MIRROR_DIRNAME = "mirror"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # API metadata
    app_name: str = "LLM Knowledge Base API"
    app_version: str = "0.1.0"
    app_description: str = "FastAPI backend for Next.js + shadcn/ui frontend"

    # Server configuration
    backend_port: int = 8000
    host: str = "0.0.0.0"
    reload: bool = True  # Auto-reload on code changes (dev only)

    # Observability / shared resources
    log_level: str = "INFO"
    http_client_timeout: float = 10.0

    # Storage: the SQLite DB file and the markdown mirror both live under this
    # directory (see ``db_path`` / ``mirror_dir``).
    data_dir: Path = Field(default=Path("data"), alias="AGENTFARM_DATA_DIR")

    # Authentication / authorisation
    ldap_server: str | None = Field(default=None, alias="AGENTFARM_LDAP_SERVER")
    ldap_dn_template: str | None = Field(
        default=None, alias="AGENTFARM_LDAP_DN_TEMPLATE"
    )
    # Owner defaults to the OS user that started the process.
    owner: str = Field(default_factory=getpass.getuser, alias="AGENTFARM_OWNER")
    # Raw comma-separated string from the env (e.g. "vue,manager"). Kept as a
    # plain ``str`` so pydantic-settings does not try to JSON-decode it (which
    # it does for ``list``-typed env fields); the parsed list is exposed via the
    # ``whitelist`` computed field below.
    whitelist_raw: str = Field(default="", alias="AGENTFARM_WHITELIST")

    # TLS: paths to an existing cert/key pair; when unset a self-signed pair is
    # generated at startup under ``data_dir`` (K4).
    tls_cert: str | None = Field(default=None, alias="AGENTFARM_TLS_CERT")
    tls_key: str | None = Field(default=None, alias="AGENTFARM_TLS_KEY")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def whitelist(self) -> list[str]:
        """Whitelisted usernames parsed from the comma-separated env value.

        ``AGENTFARM_WHITELIST="vue,manager"`` becomes ``["vue", "manager"]``;
        surrounding whitespace is stripped and empty entries dropped, so an
        unset or blank value yields an empty list.
        """
        return [
            entry.strip() for entry in self.whitelist_raw.split(",") if entry.strip()
        ]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def db_path(self) -> Path:
        """Absolute-relative path to the SQLite database file inside ``data_dir``."""
        return self.data_dir / DB_FILENAME

    @computed_field  # type: ignore[prop-decorator]
    @property
    def mirror_dir(self) -> Path:
        """Path to the markdown-mirror git repo directory inside ``data_dir``."""
        return self.data_dir / MIRROR_DIRNAME


# Global settings instance
settings = Settings()
