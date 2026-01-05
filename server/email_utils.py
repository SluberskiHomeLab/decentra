#!/usr/bin/env python3
"""
Email utilities for Decentra Chat Server
Provides SMTP email sending functionality
"""

from __future__ import annotations

import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Dict
import traceback


class EmailSender:
    """Handles sending emails via SMTP."""
    
    def __init__(self, smtp_config: Dict):
        """
        Initialize email sender with SMTP configuration.
        
        Args:
            smtp_config: Dictionary containing SMTP settings:
                - smtp_enabled: bool
                - smtp_host: str
                - smtp_port: int
                - smtp_username: str
                - smtp_password: str
                - smtp_from_email: str
                - smtp_from_name: str
                - smtp_use_tls: bool
        """
        self.enabled = smtp_config.get('smtp_enabled', False)
        self.host = smtp_config.get('smtp_host', '')
        self.port = smtp_config.get('smtp_port', 587)
        self.username = smtp_config.get('smtp_username', '')
        self.password = smtp_config.get('smtp_password', '')
        self.from_email = smtp_config.get('smtp_from_email', '')
        self.from_name = smtp_config.get('smtp_from_name', 'Decentra')
        self.use_tls = smtp_config.get('smtp_use_tls', True)
    
    def is_configured(self) -> bool:
        """Check if SMTP is properly configured."""
        if not self.enabled:
            return False
        
        required_fields = [self.host, self.from_email]
        return all(field for field in required_fields)
    
    def send_email(self, to_email: str, subject: str, body_text: str, body_html: Optional[str] = None) -> bool:
        """
        Send an email.
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            body_text: Plain text email body
            body_html: Optional HTML email body
            
        Returns:
            bool: True if email sent successfully, False otherwise
        """
        if not self.is_configured():
            print("[Email] SMTP not configured or not enabled")
            return False
        
        try:
            # Create message
            message = MIMEMultipart('alternative')
            message['Subject'] = subject
            message['From'] = f"{self.from_name} <{self.from_email}>"
            message['To'] = to_email
            
            # Add text part
            text_part = MIMEText(body_text, 'plain')
            message.attach(text_part)
            
            # Add HTML part if provided
            if body_html:
                html_part = MIMEText(body_html, 'html')
                message.attach(html_part)
            
            # Send email
            if self.use_tls:
                # Use STARTTLS
                with smtplib.SMTP(self.host, self.port, timeout=10) as server:
                    server.starttls(context=ssl.create_default_context())
                    if self.username and self.password:
                        server.login(self.username, self.password)
                    server.send_message(message)
            else:
                # Use SSL/TLS or no encryption
                if self.port == 465:
                    # Use SSL
                    with smtplib.SMTP_SSL(self.host, self.port, timeout=10, 
                                         context=ssl.create_default_context()) as server:
                        if self.username and self.password:
                            server.login(self.username, self.password)
                        server.send_message(message)
                else:
                    # No encryption
                    with smtplib.SMTP(self.host, self.port, timeout=10) as server:
                        if self.username and self.password:
                            server.login(self.username, self.password)
                        server.send_message(message)
            
            print(f"[Email] Successfully sent email to {to_email}")
            return True
            
        except smtplib.SMTPAuthenticationError as e:
            print(f"[Email] Authentication failed: {e}")
            return False
        except smtplib.SMTPException as e:
            print(f"[Email] SMTP error: {e}")
            return False
        except Exception as e:
            print(f"[Email] Error sending email: {e}")
            traceback.print_exc()
            return False
    
    def test_connection(self) -> tuple[bool, str]:
        """
        Test SMTP connection and authentication.
        
        Returns:
            tuple: (success: bool, message: str)
        """
        if not self.enabled:
            return False, "SMTP is not enabled"
        
        if not self.host or not self.from_email:
            return False, "SMTP host and from email are required"
        
        try:
            if self.use_tls:
                # Use STARTTLS
                with smtplib.SMTP(self.host, self.port, timeout=10) as server:
                    server.starttls(context=ssl.create_default_context())
                    if self.username and self.password:
                        server.login(self.username, self.password)
            else:
                # Use SSL/TLS or no encryption
                if self.port == 465:
                    # Use SSL
                    with smtplib.SMTP_SSL(self.host, self.port, timeout=10,
                                         context=ssl.create_default_context()) as server:
                        if self.username and self.password:
                            server.login(self.username, self.password)
                else:
                    # No encryption
                    with smtplib.SMTP(self.host, self.port, timeout=10) as server:
                        if self.username and self.password:
                            server.login(self.username, self.password)
            
            return True, "SMTP connection successful"
            
        except smtplib.SMTPAuthenticationError as e:
            return False, f"Authentication failed: {str(e)}"
        except smtplib.SMTPConnectError as e:
            return False, f"Connection failed: {str(e)}"
        except smtplib.SMTPException as e:
            return False, f"SMTP error: {str(e)}"
        except Exception as e:
            return False, f"Error: {str(e)}"
    
    def send_welcome_email(self, to_email: str, username: str, server_name: str = "Decentra") -> bool:
        """
        Send a welcome email to a new user.
        
        Args:
            to_email: New user's email address
            username: New user's username
            server_name: Name of the Decentra instance
            
        Returns:
            bool: True if email sent successfully
        """
        subject = f"Welcome to {server_name}!"
        
        body_text = f"""
Welcome to {server_name}, {username}!

Your account has been successfully created. You can now:
- Join servers and channels
- Send direct messages to friends
- Participate in voice channels
- Customize your profile

Thank you for joining {server_name}!

---
This is an automated message from {server_name}.
"""
        
        body_html = f"""
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #5865F2;">Welcome to {server_name}, {username}!</h2>
        
        <p>Your account has been successfully created. You can now:</p>
        
        <ul>
            <li>Join servers and channels</li>
            <li>Send direct messages to friends</li>
            <li>Participate in voice channels</li>
            <li>Customize your profile</li>
        </ul>
        
        <p>Thank you for joining {server_name}!</p>
        
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
        <p style="font-size: 12px; color: #999;">
            This is an automated message from {server_name}.
        </p>
    </div>
</body>
</html>
"""
        
        return self.send_email(to_email, subject, body_text, body_html)


def get_email_sender(db) -> EmailSender:
    """
    Get an EmailSender instance configured with current admin settings.
    
    Args:
        db: Database instance
        
    Returns:
        EmailSender instance
    """
    smtp_config = db.get_admin_settings()
    return EmailSender(smtp_config)
