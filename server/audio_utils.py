"""
Audio utilities for soundboard feature.

Provides functions for validating audio files and extracting metadata.
"""

import io
import logging
from typing import Tuple, Optional

try:
    from mutagen.mp3 import MP3
    from mutagen.wave import WAVE
    from mutagen.oggvorbis import OggVorbis
    from mutagen.oggopus import OggOpus
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

logger = logging.getLogger(__name__)

# Allowed audio formats
ALLOWED_AUDIO_FORMATS = {
    'audio/mpeg': ['.mp3'],
    'audio/wav': ['.wav'],
    'audio/wave': ['.wav'],
    'audio/x-wav': ['.wav'],
    'audio/ogg': ['.ogg'],
    'audio/opus': ['.opus'],
}


def validate_audio_format(filename: str, content_type: str) -> bool:
    """
    Validate that the file extension and content type match allowed audio formats.
    
    Args:
        filename: The name of the file
        content_type: The MIME type of the file
        
    Returns:
        True if the format is valid, False otherwise
    """
    if not filename or not content_type:
        return False
    
    # Normalize content type
    content_type = content_type.lower().split(';')[0].strip()
    
    # Get file extension
    filename_lower = filename.lower()
    file_ext = None
    for ext in ['.mp3', '.wav', '.ogg', '.opus']:
        if filename_lower.endswith(ext):
            file_ext = ext
            break
    
    if not file_ext:
        return False
    
    # Check if content type is allowed
    if content_type not in ALLOWED_AUDIO_FORMATS:
        return False
    
    # Check if extension matches content type
    allowed_extensions = ALLOWED_AUDIO_FORMATS[content_type]
    return file_ext in allowed_extensions


def get_audio_duration(file_bytes: bytes, content_type: str) -> Optional[int]:
    """
    Extract audio duration from file bytes using mutagen library.
    
    Args:
        file_bytes: The audio file content as bytes
        content_type: The MIME type of the file
        
    Returns:
        Duration in milliseconds, or None if unable to determine
        
    Raises:
        ValueError: If mutagen is not available or file is corrupted
    """
    if not MUTAGEN_AVAILABLE:
        raise ValueError("mutagen library is not installed. Run: pip install mutagen")
    
    if not file_bytes:
        return None
    
    # Normalize content type
    content_type = content_type.lower().split(';')[0].strip()
    
    try:
        # Create a file-like object from bytes
        audio_io = io.BytesIO(file_bytes)
        
        # Determine audio format and extract duration
        if content_type == 'audio/mpeg':
            audio = MP3(audio_io)
            duration_seconds = audio.info.length
        elif content_type in ['audio/wav', 'audio/wave', 'audio/x-wav']:
            audio = WAVE(audio_io)
            duration_seconds = audio.info.length
        elif content_type == 'audio/ogg':
            # Try OggVorbis first, then OggOpus
            try:
                audio = OggVorbis(audio_io)
                duration_seconds = audio.info.length
            except:
                audio_io.seek(0)
                audio = OggOpus(audio_io)
                duration_seconds = audio.info.length
        elif content_type == 'audio/opus':
            audio = OggOpus(audio_io)
            duration_seconds = audio.info.length
        else:
            logger.warning(f"Unsupported content type for duration extraction: {content_type}")
            return None
        
        # Convert to milliseconds
        duration_ms = int(duration_seconds * 1000)
        return duration_ms
        
    except Exception as e:
        logger.error(f"Error extracting audio duration: {e}")
        raise ValueError(f"Invalid or corrupted audio file: {e}")


def format_duration(duration_ms: int) -> str:
    """
    Format duration in milliseconds to a human-readable string.
    
    Args:
        duration_ms: Duration in milliseconds
        
    Returns:
        Formatted string like "3.5s" or "1m 23s"
    """
    if duration_ms < 1000:
        return f"{duration_ms}ms"
    
    seconds = duration_ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    
    minutes = int(seconds // 60)
    remaining_seconds = int(seconds % 60)
    return f"{minutes}m {remaining_seconds}s"
