"""
Secure wrapper around the detection pipeline.
Ensures all prompt text is processed in secure buffers
and wiped from memory after detection is complete.
"""

from .memory_protection import SecureBuffer, secure_wipe, disable_core_dumps

# Disable core dumps at module load time
disable_core_dumps()

class SecureDetectionContext:
    """
    Context manager that ensures all detection processing
    happens within secure memory and is cleaned up after.
    """

    def __init__(self):
        self._buffers: list[bytearray] = []
        self._results: dict = {}

    def __enter__(self):
        return self

    def allocate(self, data: str) -> bytearray:
        """Allocate secure buffer and copy data into it."""
        encoded = data.encode('utf-8')
        from .memory_protection import secure_allocate
        buf = secure_allocate(len(encoded))
        buf[:len(encoded)] = encoded
        self._buffers.append(buf)
        return buf

    def store_result(self, key: str, value) -> None:
        """Store a detection result (non-sensitive metadata only)."""
        self._results[key] = value

    def get_results(self) -> dict:
        return dict(self._results)

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Wipe all allocated buffers on exit."""
        for buf in self._buffers:
            secure_wipe(buf)
        self._buffers.clear()
        # Don't clear results - they contain only metadata
