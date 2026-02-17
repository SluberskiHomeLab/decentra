"""
Instance Fingerprinting

Generates a unique, stable identifier for this Decentra instance.
Uses machine ID, hostname, and installation path to create a fingerprint.
"""

import hashlib
import os
import platform
import socket
import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)


def _get_machine_id() -> Optional[str]:
    """
    Try to read a stable machine identifier.

    - Linux: /etc/machine-id or /var/lib/dbus/machine-id
    - macOS: IOPlatformUUID via ioreg
    - Windows: MachineGuid from registry
    """
    # Linux
    for path in ['/etc/machine-id', '/var/lib/dbus/machine-id']:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    machine_id = f.read().strip()
                    if machine_id:
                        logger.debug(f"Machine ID from {path}: {machine_id[:8]}...")
                        return machine_id
            except Exception as e:
                logger.debug(f"Failed to read {path}: {e}")

    # macOS
    if platform.system() == 'Darwin':
        try:
            import subprocess
            result = subprocess.run(
                ['ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'],
                capture_output=True,
                text=True,
                timeout=5
            )
            for line in result.stdout.split('\n'):
                if 'IOPlatformUUID' in line:
                    uuid = line.split('"')[3]
                    logger.debug(f"Machine ID from ioreg: {uuid[:8]}...")
                    return uuid
        except Exception as e:
            logger.debug(f"Failed to get macOS machine ID: {e}")

    # Windows
    if platform.system() == 'Windows':
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r'SOFTWARE\Microsoft\Cryptography',
                0,
                winreg.KEY_READ | winreg.KEY_WOW64_64KEY
            )
            value, _ = winreg.QueryValueEx(key, 'MachineGuid')
            winreg.CloseKey(key)
            logger.debug(f"Machine ID from registry: {value[:8]}...")
            return value
        except Exception as e:
            logger.debug(f"Failed to get Windows machine ID: {e}")

    logger.warning("Could not retrieve machine ID from any source")
    return None


def _get_hostname() -> str:
    """Get the system hostname."""
    try:
        hostname = socket.gethostname()
        logger.debug(f"Hostname: {hostname}")
        return hostname
    except Exception as e:
        logger.warning(f"Failed to get hostname: {e}")
        return "unknown"


def _get_install_path() -> str:
    """Get the absolute path to the server directory."""
    install_path = os.path.abspath(os.path.dirname(__file__))
    logger.debug(f"Install path: {install_path}")
    return install_path


def generate_instance_fingerprint() -> str:
    """
    Generate a stable fingerprint for this Decentra instance.

    The fingerprint is a SHA-256 hash of:
    - Machine ID (if available)
    - Hostname
    - Installation path

    Returns:
        String in format "sha256:abc123..."
    """
    components = []

    machine_id = _get_machine_id()
    if machine_id:
        components.append(f"machine_id:{machine_id}")
    else:
        logger.warning(
            "No machine ID available - fingerprint will be less stable across reinstalls"
        )

    components.append(f"hostname:{_get_hostname()}")
    components.append(f"install_path:{_get_install_path()}")

    # Create deterministic hash
    fingerprint_data = "|".join(components)
    hash_digest = hashlib.sha256(fingerprint_data.encode('utf-8')).hexdigest()

    fingerprint = f"sha256:{hash_digest}"
    logger.info(f"Generated instance fingerprint: {fingerprint[:32]}...")

    return fingerprint


def get_platform_info() -> Dict[str, str]:
    """
    Get platform information for check-in metadata.

    Returns:
        Dictionary with hostname, platform, platform_version, and python_version
    """
    return {
        "hostname": _get_hostname(),
        "platform": platform.system().lower(),
        "platform_version": platform.version(),
        "python_version": platform.python_version(),
    }


if __name__ == "__main__":
    # Test the fingerprinting when run directly
    logging.basicConfig(level=logging.DEBUG)

    print("=" * 60)
    print("Decentra Instance Fingerprinting Test")
    print("=" * 60)
    print()

    fingerprint = generate_instance_fingerprint()
    print(f"Fingerprint: {fingerprint}")
    print()

    platform_info = get_platform_info()
    print("Platform Information:")
    for key, value in platform_info.items():
        print(f"  {key}: {value}")
    print()

    # Test stability by generating again
    fingerprint2 = generate_instance_fingerprint()
    if fingerprint == fingerprint2:
        print("✓ Fingerprint is stable (matches on second generation)")
    else:
        print("✗ WARNING: Fingerprint is not stable!")
