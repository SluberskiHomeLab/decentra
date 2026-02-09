"""
Pydantic models for request/response validation
"""

from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List
from datetime import datetime


# Request Models

class VerifyRequest(BaseModel):
    """Request to verify a license"""
    license_key: str = Field(..., description="The license key to verify")
    instance_fingerprint: str = Field(..., description="Unique fingerprint of the instance")
    hostname: Optional[str] = Field(None, description="Hostname of the instance")
    platform: Optional[str] = Field(None, description="Platform (linux, windows, darwin)")
    app_version: Optional[str] = Field(None, description="Application version")


class RevokeRequest(BaseModel):
    """Request to revoke a license"""
    license_id: str = Field(..., description="License ID to revoke")
    reason: str = Field(..., description="Reason for revocation")


class RestoreRequest(BaseModel):
    """Request to restore a revoked license"""
    license_id: str = Field(..., description="License ID to restore")


class CreateLicenseRequest(BaseModel):
    """Request to create a new license"""
    license_key: str
    license_id: str
    customer_name: str
    customer_email: EmailStr
    customer_company: Optional[str] = None
    tier: str
    issued_at: datetime
    expires_at: Optional[datetime] = None
    max_installations: int = 1
    notes: Optional[str] = None


# Response Models

class VerifyResponse(BaseModel):
    """Response from license verification"""
    valid: bool
    license_id: Optional[str] = None
    tier: Optional[str] = None
    expires_at: Optional[datetime] = None
    is_revoked: bool = False
    revoked_at: Optional[datetime] = None
    revocation_reason: Optional[str] = None
    message: str


class RevokeResponse(BaseModel):
    """Response from license revocation"""
    success: bool
    license_id: str
    revoked_at: datetime
    message: str = "License revoked successfully"


class RestoreResponse(BaseModel):
    """Response from license restoration"""
    success: bool
    license_id: str
    message: str = "License restored successfully"


class InstallationInfo(BaseModel):
    """Information about an active installation"""
    instance_fingerprint: str
    hostname: Optional[str]
    platform: Optional[str]
    app_version: Optional[str]
    last_checkin: datetime
    ip_address: Optional[str]


class InstallationsResponse(BaseModel):
    """Response with installation information"""
    license_id: str
    max_installations: int
    active_count: int
    installations: List[InstallationInfo]


class LicenseDetails(BaseModel):
    """Detailed license information"""
    license_id: str
    customer_name: str
    customer_email: str
    customer_company: Optional[str]
    tier: str
    issued_at: datetime
    expires_at: Optional[datetime]
    is_revoked: bool
    revoked_at: Optional[datetime]
    revocation_reason: Optional[str]
    max_installations: int
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime


class SystemStats(BaseModel):
    """System statistics"""
    total_licenses: int
    active_licenses: int
    revoked_licenses: int
    expired_licenses: int
    total_installations: int
    checkins_last_24h: int
    checkins_last_30d: int
    licenses_by_tier: dict


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: datetime
    version: str
