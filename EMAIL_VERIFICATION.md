# Email Verification for Sign Up

## Overview

Email verification has been added to the sign-up process to improve security and ensure users provide valid email addresses. Users must now verify their email address before their account is created.

## How It Works

### User Experience

1. **Sign Up Form**: When clicking "Sign Up" on the login page, users now see:
   - Username field
   - Password field
   - **Email field (required)**
   - Invite code field (if required)

2. **Email Verification**: After submitting the form:
   - A 6-digit verification code is sent to the provided email address
   - The user is redirected back to the login page with a verification code input field
   - The username field is pre-filled

3. **Account Creation**: After entering the correct verification code:
   - The account is created
   - The user is logged in automatically
   - Email is marked as verified in the database

### Technical Details

#### Database Changes

1. **Users Table**:
   - Added `email` column (VARCHAR 255, nullable)
   - Added `email_verified` column (BOOLEAN, default FALSE)

2. **New Table: email_verification_codes**:
   ```sql
   CREATE TABLE email_verification_codes (
       email VARCHAR(255) NOT NULL,
       code VARCHAR(10) NOT NULL,
       username VARCHAR(255) NOT NULL,
       created_at TIMESTAMP NOT NULL,
       expires_at TIMESTAMP NOT NULL,
       PRIMARY KEY (email, username)
   )
   ```

#### Backend Flow

1. **Signup Request** (`type: 'signup'`):
   - Validates username, password, and email
   - Checks email format using regex
   - Generates 6-digit verification code
   - Stores code in database with 15-minute expiration
   - Sends verification email via SMTP
   - Stores pending signup data in memory
   - Returns `verification_required` response

2. **Verification Request** (`type: 'verify_email'`):
   - Retrieves pending signup data
   - Validates verification code against database
   - Creates user account with verified email
   - Cleans up verification code and pending data
   - Returns `auth_success` response

#### Frontend Flow

1. **auth.js**: 
   - Handles form mode switching (login/signup/verification)
   - Manages form field visibility
   - Stores credentials in sessionStorage

2. **chat.js**:
   - Authenticates with appropriate message type
   - Handles `verification_required` response by redirecting to login page
   - Cleans up temporary data after successful authentication

#### Email Template

The verification email includes:
- Personalized greeting with username
- Large, centered verification code
- 15-minute expiration notice
- Branded styling matching Decentra theme

## Configuration Requirements

### SMTP Settings

Email verification **requires SMTP to be configured**. If SMTP is not configured, users will see an error message when attempting to sign up.

To configure SMTP:
1. Log in as admin
2. Navigate to Admin Settings
3. Enable SMTP and configure:
   - SMTP Host
   - SMTP Port (default: 587)
   - SMTP Username
   - SMTP Password
   - From Email
   - From Name (default: "Decentra")
   - Use TLS (recommended: enabled)

### Testing SMTP

Use the built-in SMTP test feature in admin settings to verify your configuration before enabling registration.

## Security Features

1. **Email Validation**: Uses RFC 5322 compliant regex pattern
2. **Code Expiration**: Verification codes expire after 15 minutes
3. **One-Time Codes**: Codes are deleted after successful verification
4. **Rate Limiting**: Only one pending verification per username at a time
5. **Secure Storage**: Passwords are hashed before being stored temporarily

## Migration

Existing users without email addresses will continue to work normally. The email field is nullable to support backwards compatibility.

## Testing

A comprehensive test suite is available in `test_email_verification.py`:

```bash
python3 test_email_verification.py
```

Tests cover:
- Verification code creation and retrieval
- User creation with email
- Code expiration and cleanup
- Code updates/replacements

## Limitations

1. **In-Memory Storage**: Pending signups are stored in memory and will be lost on server restart. Users will need to start the signup process again.

2. **Single Server**: The current implementation assumes a single server instance. For multi-server deployments, consider using Redis for shared state.

3. **No Email Change**: Once an account is created, there's no built-in way to change the email address. This may be added in a future update.

## Future Enhancements

Potential improvements for consideration:
- Password reset via email
- Email change with re-verification
- Redis integration for distributed deployments
- Customizable verification code length
- Resend verification code option
- Email notification preferences
