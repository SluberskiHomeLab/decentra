"""
Configuration module for the licensing server
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Database
    database_url: str

    # Security
    admin_api_token: str

    # CORS
    cors_origins: str = ""

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    # Application
    app_name: str = "Decentra Licensing Server"
    app_version: str = "1.0.0"

    class Config:
        env_file = ".env"
        case_sensitive = False

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string"""
        if not self.cors_origins:
            return []
        return [origin.strip() for origin in self.cors_origins.split(",")]


# Global settings instance
settings = Settings()
