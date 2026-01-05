# SMTP Email Configuration Guide

This guide explains how to configure SMTP email notifications in Decentra.

## Overview

Decentra supports sending email notifications for various system events (like welcome emails for new users) via SMTP. The SMTP settings are configured in the Admin Configuration page, accessible only to the first user (admin).

## Accessing SMTP Settings

1. Log in as the first user (admin)
2. Navigate to the Admin Configuration page by clicking the settings icon in the chat interface
3. Scroll to the "Email & SMTP Settings" section

## Configuration Fields

### Enable Email Notifications
- **Field**: Enable Email Notifications checkbox
- **Description**: Master switch to enable/disable all email functionality
- **Default**: Disabled

### SMTP Host
- **Field**: SMTP Host
- **Description**: The hostname of your SMTP server
- **Examples**: 
  - Gmail: `smtp.gmail.com`
  - Office 365: `smtp.office365.com`
  - Custom: `mail.yourdomain.com`

### SMTP Port
- **Field**: SMTP Port
- **Description**: The port number for SMTP communication
- **Common Values**:
  - `587` - STARTTLS (recommended)
  - `465` - SSL/TLS
  - `25` - Unencrypted (not recommended)
- **Default**: 587

### SMTP Username
- **Field**: SMTP Username
- **Description**: Username for SMTP authentication (often your email address)

### SMTP Password
- **Field**: SMTP Password
- **Description**: Password for SMTP authentication
- **Note**: For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password

### From Email Address
- **Field**: From Email Address
- **Description**: The email address that will appear as the sender
- **Example**: `noreply@yourdomain.com`

### From Name
- **Field**: From Name
- **Description**: Display name for outgoing emails
- **Default**: Decentra
- **Example**: "My Decentra Server"

### Use TLS/STARTTLS
- **Field**: Use TLS/STARTTLS checkbox
- **Description**: Enable TLS encryption for secure email transmission
- **Default**: Enabled (recommended for port 587)
- **Note**: Disable for port 465 (which uses SSL instead)

## Testing Your Configuration

After entering your SMTP settings:

1. Click the **"Test SMTP Connection"** button
2. The system will attempt to connect to your SMTP server
3. A success/error message will appear below the button
4. If successful, you can save your settings
5. If it fails, check your credentials and server settings

## Common SMTP Provider Settings

### Gmail
- **Host**: smtp.gmail.com
- **Port**: 587
- **Use TLS**: Yes
- **Username**: your-email@gmail.com
- **Password**: [App Password](https://support.google.com/accounts/answer/185833)
- **Note**: You must enable 2-factor authentication and generate an app-specific password

### Office 365 / Outlook.com
- **Host**: smtp.office365.com
- **Port**: 587
- **Use TLS**: Yes
- **Username**: your-email@outlook.com or your-email@yourdomain.com
- **Password**: Your email password

### SendGrid
- **Host**: smtp.sendgrid.net
- **Port**: 587
- **Use TLS**: Yes
- **Username**: apikey
- **Password**: Your SendGrid API key

### Mailgun
- **Host**: smtp.mailgun.org
- **Port**: 587
- **Use TLS**: Yes
- **Username**: Your Mailgun SMTP username
- **Password**: Your Mailgun SMTP password

## Security Considerations

1. **Password Encryption**: SMTP passwords are encrypted at rest in the database using Fernet symmetric encryption
   - Encryption keys are derived from the `DECENTRA_ENCRYPTION_KEY` environment variable
   - For production deployments, set a strong `DECENTRA_ENCRYPTION_KEY` environment variable
   - If not set, a default key is used (less secure, but ensures functionality)
2. **Never share your SMTP credentials**: Keep your admin password and SMTP credentials secure
3. **Use app-specific passwords**: When available (like Gmail), use app-specific passwords instead of your main password
4. **Enable TLS**: Always use TLS/SSL encryption when connecting to SMTP servers
5. **Restrict admin access**: Only the first user can access SMTP settings
6. **Test regularly**: Periodically test your SMTP connection to ensure it's still working

### Setting Encryption Key for Production

For enhanced security in production environments, set the `DECENTRA_ENCRYPTION_KEY` environment variable:

**Docker Compose:**
```yaml
services:
  server:
    environment:
      - DECENTRA_ENCRYPTION_KEY=your-strong-random-passphrase-here
```

**Docker Run:**
```bash
docker run -e DECENTRA_ENCRYPTION_KEY=your-strong-random-passphrase-here ...
```

**Local Development:**
```bash
export DECENTRA_ENCRYPTION_KEY=your-strong-random-passphrase-here
python server.py
```

**Important:** Keep your encryption key secure and consistent across deployments. If you change the key, existing encrypted passwords will not be decryptable.

## Troubleshooting

### Connection Failed
- Verify your SMTP host and port are correct
- Check if your firewall allows outbound connections on the SMTP port
- Ensure your server has internet connectivity

### Authentication Failed
- Double-check your username and password
- For Gmail, ensure you're using an App Password, not your regular password
- Verify your account has SMTP access enabled

### TLS/SSL Errors
- Try toggling the "Use TLS/STARTTLS" checkbox
- For port 465, disable TLS (it uses SSL instead)
- For port 587, enable TLS

### Emails Not Sending
- Verify SMTP is enabled in settings
- Check the server logs for error messages
- Test the SMTP connection using the test button
- Ensure your SMTP provider allows sending from your configured email address

## Email Notifications

Once SMTP is configured, Decentra will send emails for:

- **Welcome emails**: When new users create an account
- **Future features**: Password reset, server invitations, and more (coming soon)

## Support

If you continue to have issues:
1. Check the server logs for detailed error messages
2. Test your SMTP settings with an email client (like Thunderbird) to verify they work
3. Consult your SMTP provider's documentation for specific configuration requirements
