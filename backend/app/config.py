from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = Field(default="dev")
    database_url: str = Field(default="postgresql+psycopg://flexpay:flexpay@localhost:5432/flexpay")
    redis_url: str = Field(default="redis://localhost:6379/0")

    jwt_private_key_path: str = Field(default="./keys/jwt_private.pem")
    jwt_public_key_path: str = Field(default="./keys/jwt_public.pem")
    jwt_algorithm: str = Field(default="RS256")
    access_token_ttl_seconds: int = Field(default=900)
    refresh_token_ttl_seconds: int = Field(default=60 * 60 * 24 * 30)

    otp_ttl_seconds: int = Field(default=300)
    otp_dev_fixed_code: str | None = Field(default="123456")

    rate_limit_per_minute: int = Field(default=60)


@lru_cache
def get_settings() -> Settings:
    return Settings()
