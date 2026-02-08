# Email Change Verification - Usage Guide

## Overview

This feature allows users to verify their new email address after changing it. When a user changes their email, a 6-digit verification code is generated and sent to the new email address (if SMTP is configured and email verification is enabled). The user can then verify their new email by submitting the code.

## WebSocket API

### 1. Change Email

**Message Type:** `change_email`

**Request:**
```json
{
  "type": "change_email",
  "new_email": "newemail@example.com",
  "password": "user_password"
}
```

**Success Response:**
```json
{
  "type": "email_changed",
  "email": "newemail@example.com",
  "email_verified": false
}
```

**Error Responses:**
```json
{
  "type": "error",
  "message": "Invalid email address format"
}
```
```json
{
  "type": "error",
  "message": "Invalid password"
}
```
```json
{
  "type": "error",
  "message": "Email address already in use"
}
```

### 2. Verify Email Change

**Message Type:** `verify_email_change`

**Request:**
```json
{
  "type": "verify_email_change",
  "code": "123456"
}
```

**Success Response:**
```json
{
  "type": "email_verified",
  "email": "newemail@example.com",
  "email_verified": true
}
```

**Error Responses:**
```json
{
  "type": "error",
  "message": "Invalid verification code format"
}
```
```json
{
  "type": "error",
  "message": "Invalid or expired verification code"
}
```
```json
{
  "type": "error",
  "message": "No email associated with this account"
}
```
```json
{
  "type": "error",
  "message": "Failed to verify email"
}
```

## Flow Diagram

```
User                          Server                         Database
 |                              |                                |
 | 1. change_email              |                                |
 |----------------------------->|                                |
 |                              | 2. Validate password           |
 |                              |-------------------------------->|
 |                              |                                |
 |                              | 3. Update email                |
 |                              |-------------------------------->|
 |                              |                                |
 |                              | 4. Generate 6-digit code       |
 |                              | 5. Store code (15min expiry)   |
 |                              |-------------------------------->|
 |                              |                                |
 |                              | 6. Send verification email     |
 |                              |                                |
 | 7. email_changed response    |                                |
 |<-----------------------------|                                |
 |    (email_verified: false)   |                                |
 |                              |                                |
 | [User checks email and gets code]                            |
 |                              |                                |
 | 8. verify_email_change       |                                |
 |----------------------------->|                                |
 |                              | 9. Validate code               |
 |                              |-------------------------------->|
 |                              |                                |
 |                              | 10. Mark email as verified     |
 |                              |-------------------------------->|
 |                              |                                |
 |                              | 11. Delete verification code   |
 |                              |-------------------------------->|
 |                              |                                |
 | 12. email_verified response  |                                |
 |<-----------------------------|                                |
 |    (email_verified: true)    |                                |
```

## Implementation Details

### Verification Code
- **Format**: 6 digits (e.g., "123456")
- **Generation**: Cryptographically random using `secrets.choice()`
- **Expiration**: 15 minutes from creation
- **Storage**: `email_verification_codes` table with composite key (email, username)

### Security Features
1. **Password Required**: User must provide their current password to change email
2. **Code Expiration**: Codes automatically expire after 15 minutes
3. **One-Time Use**: Codes are deleted after successful verification
4. **Email Validation**: Email format is validated before change
5. **Duplicate Prevention**: Cannot change to an email already in use
6. **Automatic Cleanup**: Expired codes are periodically removed

### Database Schema

The `email_verification_codes` table:
```sql
CREATE TABLE email_verification_codes (
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    username VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    PRIMARY KEY (email, username)
);
```

## Configuration

Email verification requires SMTP to be configured in admin settings:
1. Enable `require_email_verification` in admin settings
2. Configure SMTP settings (server, port, username, password)
3. Test SMTP connection to ensure emails can be sent

## Testing

Run the comprehensive test suite:
```bash
cd product-test
python3 test_email_change_verification.py
```

Tests include:
- Complete email change verification flow
- Invalid verification code handling
- Expired verification code handling
- Multiple email changes scenario

## TypeScript Types

```typescript
export type WsEmailChanged = {
  type: 'email_changed'
  email: string
  email_verified: boolean
}

export type WsEmailVerified = {
  type: 'email_verified'
  email: string
  email_verified: boolean
}
```

## Example Client Implementation

```javascript
// Change email
ws.send(JSON.stringify({
  type: 'change_email',
  new_email: 'newemail@example.com',
  password: userPassword
}));

// Handle response
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'email_changed') {
    // Show verification code input form
    showVerificationForm();
  } else if (data.type === 'email_verified') {
    // Email successfully verified
    showSuccess('Email verified successfully!');
  } else if (data.type === 'error') {
    // Handle error
    showError(data.message);
  }
};

// Verify email with code
function verifyEmail(code) {
  ws.send(JSON.stringify({
    type: 'verify_email_change',
    code: code
  }));
}
```

## Notes

- Email verification is only sent if SMTP is configured and `require_email_verification` is enabled in admin settings
- If SMTP is not configured, email is changed but remains unverified
- Users can change their email multiple times, but only the most recent verification code is valid
- Verification codes for the previous email become invalid when email is changed again
