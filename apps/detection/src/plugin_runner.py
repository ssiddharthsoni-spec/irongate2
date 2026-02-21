"""
Iron Gate Plugin Runner

Executes firm-specific detection plugins (pattern-based) to extend
the detection pipeline with custom entity types and patterns defined
per-firm. This is the Python-side equivalent of the TypeScript plugin
runner used by the proxy service.
"""

import re
from dataclasses import dataclass


@dataclass
class PluginResult:
    type: str
    text: str
    start: int
    end: int
    confidence: float
    source: str


class PluginRunner:
    """
    Runs firm-custom detection plugins against input text.

    Each plugin is a dict with the following shape:
        {
            "name": "my_plugin",
            "is_active": True,
            "patterns": ["regex1", "regex2"],
            "entity_types": ["CUSTOM_TYPE"],
        }
    """

    def run_plugins(self, text: str, plugins: list[dict]) -> list[PluginResult]:
        """Execute firm-custom detection plugins (pattern-based only for Python)."""
        results = []
        for plugin in plugins:
            if not plugin.get('is_active', True):
                continue
            try:
                plugin_results = self._execute_plugin(text, plugin)
                results.extend(plugin_results)
            except Exception as e:
                print(f"Plugin {plugin.get('name', 'unknown')} failed: {e}")
        return results

    def _execute_plugin(self, text: str, plugin: dict) -> list[PluginResult]:
        """Execute a single plugin's patterns against text."""
        results = []
        patterns = plugin.get('patterns', [])
        entity_types = plugin.get('entity_types', [])
        plugin_name = plugin.get('name', 'custom')

        for pattern_str in patterns:
            try:
                for match in re.finditer(pattern_str, text):
                    for entity_type in entity_types:
                        results.append(PluginResult(
                            type=entity_type,
                            text=match.group(),
                            start=match.start(),
                            end=match.end(),
                            confidence=0.85,
                            source=f"plugin:{plugin_name}",
                        ))
            except re.error:
                continue
        return results
