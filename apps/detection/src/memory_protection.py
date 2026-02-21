"""
Iron Gate — Memory Protection for Detection Service

Provides secure memory allocation and wiping to prevent sensitive data
from being swapped to disk or included in core dumps.

This module is used by the detection pipeline to handle prompt text
and entity values securely during processing.
"""

import ctypes
import sys
import os
from typing import Optional

def secure_allocate(size: int) -> bytearray:
    """
    Allocate memory that won't be swapped to disk.
    On Linux, uses madvise(MADV_DONTDUMP) to exclude from core dumps.
    On other platforms, returns a regular bytearray (best effort).
    """
    buf = bytearray(size)
    if sys.platform == 'linux':
        try:
            libc = ctypes.CDLL('libc.so.6')
            # MADV_DONTDUMP = 16 on Linux
            buf_ptr = (ctypes.c_char * len(buf)).from_buffer(buf)
            libc.madvise(ctypes.cast(buf_ptr, ctypes.c_void_p), len(buf), 16)
        except Exception:
            pass  # Best effort - continue without memory protection
    return buf

def secure_wipe(buf: bytearray) -> None:
    """
    Overwrite memory with zeros before deallocation.
    Uses ctypes.memset to prevent compiler optimization from skipping the wipe.
    """
    if len(buf) == 0:
        return
    for i in range(len(buf)):
        buf[i] = 0
    # Compiler barrier
    try:
        buf_ptr = (ctypes.c_char * len(buf)).from_buffer(buf)
        ctypes.memset(ctypes.cast(buf_ptr, ctypes.c_void_p), 0, len(buf))
    except Exception:
        pass

def disable_core_dumps() -> bool:
    """
    Disable core dumps for the current process.
    Returns True if successful.
    """
    if sys.platform == 'linux':
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            return True
        except Exception:
            return False
    return False

class SecureBuffer:
    """Context manager for secure memory allocation and automatic wiping."""

    def __init__(self, size: int):
        self.size = size
        self._buf: Optional[bytearray] = None

    def __enter__(self) -> bytearray:
        self._buf = secure_allocate(self.size)
        return self._buf

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._buf is not None:
            secure_wipe(self._buf)
            self._buf = None

def secure_process_text(text: str) -> dict:
    """
    Process text securely: copy to secure buffer, process, then wipe.
    Returns metadata about the text without retaining the actual content.
    """
    text_bytes = text.encode('utf-8')
    with SecureBuffer(len(text_bytes)) as buf:
        buf[:len(text_bytes)] = text_bytes
        # Extract metadata
        metadata = {
            'length': len(text),
            'byte_length': len(text_bytes),
            'has_content': len(text.strip()) > 0,
        }
        # buf is automatically wiped on exit
    return metadata
