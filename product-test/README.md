# Product Tests

This folder contains all test files for the Decentra application.

## Running Tests

### Run all basic tests
```bash
cd product-test
bash test.sh
```

### Run individual test files
```bash
cd product-test
python3 test_ssl.py
python3 test_https_server.py
python3 test_database.py
# ... etc
```

### Run from repository root
```bash
python3 product-test/test_ssl.py
# or
cd product-test && python3 test_ssl.py
```

## Test Files

- `test.sh` - Basic test suite runner
- `test_admin_option_visibility.py` - Admin button visibility tests
- `test_admin_settings.py` - Admin settings functionality tests
- `test_auth_workflow.py` - Authentication workflow tests
- `test_custom_emojis_reactions.py` - Custom emoji and reactions tests
- `test_database.py` - Database functionality tests
- `test_email_verification.py` - Email verification tests
- `test_encryption_key_required.py` - Encryption key validation tests
- `test_file_attachments.py` - File attachment tests
- `test_https_server.py` - HTTPS server tests
- `test_message_edit_delete.py` - Message editing and deletion tests
- `test_message_encryption.py` - Message encryption tests
- `test_profile.py` - User profile tests
- `test_rich_embeds.py` - Rich embeds functionality tests
- `test_rich_embeds.html` - Rich embeds visual examples
- `test_server_icon.py` - Server icon tests
- `test_server_icon_unit.py` - Server icon unit tests
- `test_signup_flow.py` - Signup flow tests
- `test_signup_integration.py` - Signup integration tests
- `test_smtp.py` - SMTP functionality tests
- `test_ssl.py` - SSL certificate tests
- `test_token_auth.py` - Token authentication tests
