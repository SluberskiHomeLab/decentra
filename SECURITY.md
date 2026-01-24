# Security Features

This document describes the security features available in Decentra.

## Overview

Decentra includes several security features to protect your data and communications:

1. **Transport Layer Security (TLS)**: All communications use HTTPS/WSS encryption
2. **Data Encryption at Rest**: Messages and sensitive data are encrypted in the database
3. **Two-Factor Authentication (2FA)**: Optional TOTP-based second factor for login
4. **Password Reset Flow**: Secure password recovery via email
5. **Attachment Management**: Delete attachments with proper permission controls

## Transport Layer Security

### HTTPS and WebSocket Secure (WSS)

All communications between the client and server are encrypted using TLS:

- **HTTPS**: Web interface served over HTTPS on port 8765
- **WSS**: WebSocket connections use secure WebSocket protocol
- **Self-Signed Certificates**: Server automatically generates SSL certificates for local deployment

The server uses modern TLS protocols to ensure messages in transit are encrypted and cannot be intercepted.

## Data Encryption at Rest

### Message Encryption

All messages stored in the database are encrypted using:
- **Algorithm**: Fernet (symmetric encryption)
- **Key Derivation**: PBKDF2-HMAC with SHA256, 100,000 iterations
- **Environment Variable**: `DECENTRA_ENCRYPTION_KEY` (required)

### SMTP Password Encryption

Admin-configured SMTP passwords are encrypted using the same Fernet cipher before storage.

## Two-Factor Authentication (2FA)

### Setup

Users can enable 2FA for their account:

1. Navigate to Security Settings
2. Click "Enable Two-Factor Authentication"
3. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)
4. Enter the 6-digit code to verify setup
5. Save the backup codes in a secure location

### Login with 2FA

When 2FA is enabled:
1. Enter username and password as usual
2. Enter the 6-digit code from your authenticator app
3. Alternatively, use one of your backup codes

### Backup Codes

- 10 one-time backup codes are generated during setup
- Each code can only be used once
- Store these in a secure location
- Use them if you lose access to your authenticator app

### Disabling 2FA

To disable 2FA:
1. Navigate to Security Settings
2. Click "Disable Two-Factor Authentication"
3. Enter your password
4. Enter a 2FA code or backup code to confirm

## Password Reset

### Requesting a Reset

1. Click "Forgot Password" on the login page
2. Enter your username or email address
3. If an account exists with that email, a reset link will be sent
4. The reset link is valid for 1 hour

### Resetting Your Password

1. Click the link in the password reset email
2. Enter your new password (minimum 6 characters)
3. Click "Reset Password"
4. You can now log in with your new password

### Security Features

- Reset tokens expire after 1 hour
- Tokens can only be used once
- Email enumeration protection: always shows success message
- Expired tokens are automatically cleaned up

## Attachment Management

### Deleting Attachments

Users and server administrators can delete attachments:

**Permissions**:
- Users can delete attachments from their own messages
- Server owners can delete any attachment in their server
- Users with "Delete Messages" permission can delete any attachment

**How to Delete**:
1. Right-click on an attachment in a message
2. Click "Delete Attachment"
3. Confirm the deletion
4. The attachment is permanently removed

### Retention Policy

Administrators can configure automatic attachment cleanup:
- Set retention period in days
- Attachments older than the retention period are automatically deleted
- Cleanup runs daily

## Best Practices

### For Users

1. **Use Strong Passwords**: Minimum 6 characters with mixed case, numbers, and symbols
2. **Enable 2FA**: Add an extra layer of security to your account
3. **Save Backup Codes**: Store them in a password manager or secure location
4: **Verify Email**: Complete email verification to enable password reset
5. **Keep Software Updated**: Use the latest version of Decentra

### For Administrators

1. **Set Strong Encryption Key**: Use a cryptographically random key for `DECENTRA_ENCRYPTION_KEY`
2. **Configure SMTP**: Enable email notifications for password resets
3. **Monitor Access**: Review server logs for suspicious activity
4. **Regular Backups**: Back up the PostgreSQL database regularly
5. **Update Dependencies**: Keep all dependencies up to date
6. **Use HTTPS**: Never disable SSL/TLS in production

## API Security

### JWT Tokens

- Token-based authentication for REST API and WebSocket connections
- Tokens expire after 24 hours
- Secret key stored securely in environment variable or file
- Tokens are validated on every request

### Rate Limiting

Consider implementing rate limiting for:
- Password reset requests
- Login attempts
- API requests

## Environment Variables

Required security-related environment variables:

```bash
# Encryption key for data at rest (REQUIRED)
DECENTRA_ENCRYPTION_KEY=your-random-key-here

# JWT secret key (optional, auto-generated if not provided)
JWT_SECRET_KEY=your-jwt-secret-here

# Database connection (contains credentials)
DATABASE_URL=postgresql://user:password@host:5432/db
```

## Compliance and Standards

Decentra follows security best practices:

- **Password Hashing**: bcrypt with automatic salt generation
- **Encryption**: NIST-approved algorithms (AES via Fernet)
- **TLS**: Industry-standard transport encryption
- **2FA**: TOTP (RFC 6238) compatible with standard authenticator apps

## Reporting Security Issues

If you discover a security vulnerability in Decentra:

1. **Do not** open a public issue
2. Contact the maintainers privately
3. Include details about the vulnerability
4. Allow time for a fix before public disclosure

## Limitations

Current limitations:

1. **End-to-End Encryption**: Messages are encrypted in transit (TLS) and at rest, but not end-to-end encrypted between clients
2. **Rate Limiting**: No built-in rate limiting (implement at reverse proxy level)
3. **Audit Logging**: Limited security event logging
4. **Session Management**: No session invalidation mechanism

## Future Enhancements

Planned security improvements:

- Client-side end-to-end encryption
- Enhanced audit logging
- IP-based rate limiting
- Account lockout after failed login attempts
- Security headers (CSP, HSTS, etc.)
- Two-factor authentication recovery options
