"""
Decentra Licensing Server

FastAPI-based server for license verification, revocation, and installation tracking.
"""

from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from datetime import datetime, timezone
import logging
from typing import Optional

from config import settings
from database import get_pool, close_pool
from models import (
    VerifyRequest, VerifyResponse,
    RevokeRequest, RevokeResponse,
    RestoreRequest, RestoreResponse,
    InstallationsResponse, InstallationInfo,
    LicenseDetails, SystemStats, HealthResponse,
    CreateLicenseRequest
)

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="License verification and management API for Decentra"
)

# Configure CORS
if settings.cors_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Configure rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Startup and shutdown events

@app.on_event("startup")
async def startup():
    """Initialize database pool on startup"""
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    await get_pool()
    logger.info("Database connection pool created")


@app.on_event("shutdown")
async def shutdown():
    """Close database pool on shutdown"""
    logger.info("Shutting down...")
    await close_pool()
    logger.info("Shutdown complete")


# Authentication dependency

def verify_admin_token(authorization: Optional[str] = Header(None)):
    """Verify admin API token from Authorization header"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    # Expected format: "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization format")

    token = parts[1]
    if token != settings.admin_api_token:
        raise HTTPException(status_code=401, detail="Invalid admin token")

    return True


# Public Endpoints

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        timestamp=datetime.now(timezone.utc),
        version=settings.app_version
    )


@app.post("/api/v1/verify", response_model=VerifyResponse)
@limiter.limit("10/minute")
async def verify_license(request: Request, verify_req: VerifyRequest):
    """
    Verify a license and record check-in.

    This endpoint checks:
    1. Does the license exist in our database?
    2. Has it been revoked?
    3. Has it expired?
    4. Is the installation count within limits?
    """
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Find license by key
        license_row = await conn.fetchrow(
            """
            SELECT license_id, tier, expires_at, is_revoked,
                   revoked_at, revocation_reason, max_installations
            FROM licenses
            WHERE license_key = $1
            """,
            verify_req.license_key
        )

        if not license_row:
            logger.warning(f"License key not found in database")
            raise HTTPException(
                status_code=404,
                detail={
                    "valid": False,
                    "message": "License key not found in licensing system"
                }
            )

        license_id = license_row['license_id']

        # Check if revoked
        if license_row['is_revoked']:
            logger.warning(f"License {license_id} is revoked")
            return VerifyResponse(
                valid=False,
                license_id=license_id,
                is_revoked=True,
                revoked_at=license_row['revoked_at'],
                revocation_reason=license_row['revocation_reason'],
                message="License has been revoked"
            )

        # Check expiration
        if license_row['expires_at']:
            expires_at = license_row['expires_at']
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)

            if datetime.now(timezone.utc) > expires_at:
                logger.warning(f"License {license_id} has expired")
                return VerifyResponse(
                    valid=False,
                    license_id=license_id,
                    tier=license_row['tier'],
                    expires_at=expires_at,
                    message="License has expired"
                )

        # Check installation count
        active_installations = await conn.fetch(
            """
            SELECT DISTINCT instance_fingerprint
            FROM license_checkins
            WHERE license_id = $1
              AND checked_in_at > NOW() - INTERVAL '60 days'
            """,
            license_id
        )

        max_installations = license_row['max_installations']
        active_fingerprints = [row['instance_fingerprint'] for row in active_installations]

        # Check if this is a new installation
        is_existing = verify_req.instance_fingerprint in active_fingerprints

        if not is_existing and len(active_fingerprints) >= max_installations:
            logger.warning(
                f"License {license_id} installation limit exceeded: "
                f"{len(active_fingerprints)}/{max_installations}"
            )
            return VerifyResponse(
                valid=False,
                license_id=license_id,
                tier=license_row['tier'],
                message=f"Maximum installations exceeded. Allowed: {max_installations}, "
                        f"Active: {len(active_fingerprints)}"
            )

        # Get client IP
        client_ip = request.client.host if request.client else None

        # Record check-in
        await conn.execute(
            """
            INSERT INTO license_checkins
                (license_id, instance_fingerprint, instance_hostname,
                 instance_platform, app_version, checked_in_at, ip_address)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6)
            """,
            license_id,
            verify_req.instance_fingerprint,
            verify_req.hostname,
            verify_req.platform,
            verify_req.app_version,
            client_ip
        )

        logger.info(
            f"License {license_id} verified successfully "
            f"(fingerprint: {verify_req.instance_fingerprint[:16]}...)"
        )

        # Return success
        return VerifyResponse(
            valid=True,
            license_id=license_id,
            tier=license_row['tier'],
            expires_at=license_row['expires_at'],
            is_revoked=False,
            message="License is valid"
        )


# Admin Endpoints

@app.post("/api/v1/admin/revoke", response_model=RevokeResponse)
async def revoke_license(
    revoke_req: RevokeRequest,
    _: bool = Depends(verify_admin_token)
):
    """Revoke a license (admin only)"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Check if license exists
        license_exists = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM licenses WHERE license_id = $1)",
            revoke_req.license_id
        )

        if not license_exists:
            raise HTTPException(status_code=404, detail="License not found")

        # Revoke the license
        revoked_at = datetime.now(timezone.utc)
        await conn.execute(
            """
            UPDATE licenses
            SET is_revoked = TRUE,
                revoked_at = $2,
                revocation_reason = $3,
                updated_at = NOW()
            WHERE license_id = $1
            """,
            revoke_req.license_id,
            revoked_at,
            revoke_req.reason
        )

        logger.info(f"License {revoke_req.license_id} revoked: {revoke_req.reason}")

        return RevokeResponse(
            success=True,
            license_id=revoke_req.license_id,
            revoked_at=revoked_at
        )


@app.post("/api/v1/admin/restore", response_model=RestoreResponse)
async def restore_license(
    restore_req: RestoreRequest,
    _: bool = Depends(verify_admin_token)
):
    """Restore a revoked license (admin only)"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Check if license exists and is revoked
        license_row = await conn.fetchrow(
            "SELECT is_revoked FROM licenses WHERE license_id = $1",
            restore_req.license_id
        )

        if not license_row:
            raise HTTPException(status_code=404, detail="License not found")

        if not license_row['is_revoked']:
            raise HTTPException(status_code=400, detail="License is not revoked")

        # Restore the license
        await conn.execute(
            """
            UPDATE licenses
            SET is_revoked = FALSE,
                revoked_at = NULL,
                revocation_reason = NULL,
                updated_at = NOW()
            WHERE license_id = $1
            """,
            restore_req.license_id
        )

        logger.info(f"License {restore_req.license_id} restored")

        return RestoreResponse(
            success=True,
            license_id=restore_req.license_id
        )


@app.get("/api/v1/admin/licenses/{license_id}", response_model=LicenseDetails)
async def get_license_details(
    license_id: str,
    _: bool = Depends(verify_admin_token)
):
    """Get detailed information about a license (admin only)"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        license_row = await conn.fetchrow(
            """
            SELECT license_id, customer_name, customer_email, customer_company,
                   tier, issued_at, expires_at, is_revoked, revoked_at,
                   revocation_reason, max_installations, notes,
                   created_at, updated_at
            FROM licenses
            WHERE license_id = $1
            """,
            license_id
        )

        if not license_row:
            raise HTTPException(status_code=404, detail="License not found")

        return LicenseDetails(**dict(license_row))


@app.get("/api/v1/admin/licenses/{license_id}/installations", response_model=InstallationsResponse)
async def get_installations(
    license_id: str,
    _: bool = Depends(verify_admin_token)
):
    """Get active installations for a license (admin only)"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get license info
        license_row = await conn.fetchrow(
            "SELECT max_installations FROM licenses WHERE license_id = $1",
            license_id
        )

        if not license_row:
            raise HTTPException(status_code=404, detail="License not found")

        # Get active installations
        installations = await conn.fetch(
            """
            SELECT instance_fingerprint, instance_hostname, instance_platform,
                   app_version, last_checkin, ip_address
            FROM active_installations
            WHERE license_id = $1
            ORDER BY last_checkin DESC
            """,
            license_id
        )

        return InstallationsResponse(
            license_id=license_id,
            max_installations=license_row['max_installations'],
            active_count=len(installations),
            installations=[InstallationInfo(**dict(inst)) for inst in installations]
        )


@app.get("/api/v1/admin/stats", response_model=SystemStats)
async def get_system_stats(_: bool = Depends(verify_admin_token)):
    """Get system statistics (admin only)"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Total licenses
        total_licenses = await conn.fetchval("SELECT COUNT(*) FROM licenses")

        # Active licenses (not revoked, not expired)
        active_licenses = await conn.fetchval(
            """
            SELECT COUNT(*) FROM licenses
            WHERE is_revoked = FALSE
              AND (expires_at IS NULL OR expires_at > NOW())
            """
        )

        # Revoked licenses
        revoked_licenses = await conn.fetchval(
            "SELECT COUNT(*) FROM licenses WHERE is_revoked = TRUE"
        )

        # Expired licenses
        expired_licenses = await conn.fetchval(
            """
            SELECT COUNT(*) FROM licenses
            WHERE is_revoked = FALSE
              AND expires_at IS NOT NULL
              AND expires_at <= NOW()
            """
        )

        # Total installations (distinct fingerprints in last 60 days)
        total_installations = await conn.fetchval(
            """
            SELECT COUNT(DISTINCT instance_fingerprint)
            FROM license_checkins
            WHERE checked_in_at > NOW() - INTERVAL '60 days'
            """
        )

        # Check-ins last 24h
        checkins_24h = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM license_checkins
            WHERE checked_in_at > NOW() - INTERVAL '24 hours'
            """
        )

        # Check-ins last 30d
        checkins_30d = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM license_checkins
            WHERE checked_in_at > NOW() - INTERVAL '30 days'
            """
        )

        # Licenses by tier
        tier_counts = await conn.fetch(
            "SELECT tier, COUNT(*) as count FROM licenses GROUP BY tier"
        )
        licenses_by_tier = {row['tier']: row['count'] for row in tier_counts}

        return SystemStats(
            total_licenses=total_licenses,
            active_licenses=active_licenses,
            revoked_licenses=revoked_licenses,
            expired_licenses=expired_licenses,
            total_installations=total_installations,
            checkins_last_24h=checkins_24h,
            checkins_last_30d=checkins_30d,
            licenses_by_tier=licenses_by_tier
        )


@app.post("/api/v1/admin/licenses", response_model=LicenseDetails)
async def create_license(
    license_req: CreateLicenseRequest,
    _: bool = Depends(verify_admin_token)
):
    """Create a new license in the database (admin only)"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Check if license already exists
        exists = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM licenses WHERE license_id = $1 OR license_key = $2)",
            license_req.license_id,
            license_req.license_key
        )

        if exists:
            raise HTTPException(
                status_code=400,
                detail="License with this ID or key already exists"
            )

        # Insert new license
        await conn.execute(
            """
            INSERT INTO licenses
                (license_key, license_id, customer_name, customer_email,
                 customer_company, tier, issued_at, expires_at,
                 max_installations, notes, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            """,
            license_req.license_key,
            license_req.license_id,
            license_req.customer_name,
            license_req.customer_email,
            license_req.customer_company,
            license_req.tier,
            license_req.issued_at,
            license_req.expires_at,
            license_req.max_installations,
            license_req.notes
        )

        logger.info(f"Created new license: {license_req.license_id}")

        # Fetch and return the created license
        license_row = await conn.fetchrow(
            """
            SELECT license_id, customer_name, customer_email, customer_company,
                   tier, issued_at, expires_at, is_revoked, revoked_at,
                   revocation_reason, max_installations, notes,
                   created_at, updated_at
            FROM licenses
            WHERE license_id = $1
            """,
            license_req.license_id
        )

        return LicenseDetails(**dict(license_row))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level=settings.log_level.lower()
    )
