"""
Detection Pipeline
Combines Presidio + GLiNER + Custom Recognizers for comprehensive PII detection.
"""

from typing import Optional
import logging

logger = logging.getLogger(__name__)


class DetectionPipeline:
    """
    Multi-engine detection pipeline that combines:
    1. Microsoft Presidio (rule-based + NER)
    2. GLiNER (transformer-based NER)
    3. Custom legal recognizers
    """

    def __init__(self):
        self._presidio_engine = None
        self._gliner_model = None
        self._custom_recognizers = []
        self._initialized = False
        self._initialize()

    def _initialize(self):
        """Initialize all detection engines."""
        try:
            self._init_presidio()
            logger.info("Presidio engine initialized")
        except Exception as e:
            logger.warning(f"Presidio initialization failed: {e}")

        try:
            self._init_gliner()
            logger.info("GLiNER model initialized")
        except Exception as e:
            logger.warning(f"GLiNER initialization failed: {e}")

        try:
            self._init_custom_recognizers()
            logger.info("Custom recognizers initialized")
        except Exception as e:
            logger.warning(f"Custom recognizer initialization failed: {e}")

        self._initialized = True

    def _init_presidio(self):
        """Initialize Microsoft Presidio with custom configuration."""
        try:
            from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
            from presidio_analyzer.nlp_engine import NlpEngineProvider

            # Configure NLP engine
            provider = NlpEngineProvider(nlp_configuration={
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
            })
            nlp_engine = provider.create_engine()

            # Create registry and add custom recognizers
            registry = RecognizerRegistry()
            registry.load_predefined_recognizers(nlp_engine=nlp_engine)

            # Add custom legal recognizers
            for recognizer in self._custom_recognizers:
                registry.add_recognizer(recognizer)

            self._presidio_engine = AnalyzerEngine(
                nlp_engine=nlp_engine,
                registry=registry,
            )
        except ImportError:
            logger.warning("Presidio not available, skipping")

    def _init_gliner(self):
        """Initialize GLiNER transformer model."""
        try:
            from gliner import GLiNER

            self._gliner_model = GLiNER.from_pretrained(
                "knowledgator/gliner-multitask-large-v0.5"
            )
            logger.info("GLiNER model loaded successfully")
        except ImportError:
            logger.warning("GLiNER not available, skipping")
        except Exception as e:
            logger.warning(f"GLiNER model loading failed: {e}")

    def _init_custom_recognizers(self):
        """Initialize custom legal recognizers."""
        from .recognizers.matter_number import MatterNumberRecognizer
        from .recognizers.privilege_marker import PrivilegeMarkerRecognizer
        from .recognizers.client_matter_pair import ClientMatterPairRecognizer
        from .recognizers.deal_codename import DealCodenameRecognizer
        from .recognizers.opposing_counsel import OpposingCounselRecognizer

        self._custom_recognizers = [
            MatterNumberRecognizer(),
            PrivilegeMarkerRecognizer(),
            ClientMatterPairRecognizer(),
            DealCodenameRecognizer(),
            OpposingCounselRecognizer(),
        ]

    def detect(
        self,
        text: str,
        entity_types: Optional[list[str]] = None,
        language: str = "en",
        score_threshold: float = 0.3,
    ) -> list[dict]:
        """
        Run detection across all engines and merge results.
        """
        all_entities = []

        # 1. Run Presidio
        if self._presidio_engine:
            try:
                presidio_results = self._presidio_engine.analyze(
                    text=text,
                    entities=entity_types,
                    language=language,
                    score_threshold=score_threshold,
                )
                for result in presidio_results:
                    all_entities.append({
                        "type": result.entity_type,
                        "text": text[result.start:result.end],
                        "start": result.start,
                        "end": result.end,
                        "confidence": result.score,
                        "source": "presidio",
                    })
            except Exception as e:
                logger.error(f"Presidio detection error: {e}")

        # 2. Run GLiNER
        if self._gliner_model:
            try:
                gliner_labels = entity_types or [
                    "person", "organization", "location", "date",
                    "phone number", "email", "credit card", "social security number",
                    "monetary amount", "account number", "ip address",
                    "medical record", "passport number", "driver license",
                ]

                gliner_results = self._gliner_model.predict_entities(
                    text, gliner_labels, threshold=score_threshold
                )

                for result in gliner_results:
                    all_entities.append({
                        "type": self._normalize_entity_type(result.get("label", "")),
                        "text": result.get("text", text[result["start"]:result["end"]]),
                        "start": result["start"],
                        "end": result["end"],
                        "confidence": result.get("score", 0.5),
                        "source": "gliner",
                    })
            except Exception as e:
                logger.error(f"GLiNER detection error: {e}")

        # 3. Run custom recognizers
        for recognizer in self._custom_recognizers:
            try:
                results = recognizer.analyze(text, language)
                for result in results:
                    all_entities.append({
                        "type": result.entity_type,
                        "text": text[result.start:result.end],
                        "start": result.start,
                        "end": result.end,
                        "confidence": result.score,
                        "source": "custom",
                    })
            except Exception as e:
                logger.error(f"Custom recognizer error ({recognizer.__class__.__name__}): {e}")

        # Merge overlapping entities (prefer higher confidence)
        merged = self._merge_entities(all_entities)

        # Boost confidence when multiple engines agree
        boosted = self._boost_agreement(merged, all_entities)

        return boosted

    def score(
        self,
        text: str,
        entities: list[dict],
        firm_id: Optional[str] = None,
    ) -> tuple[int, str, str]:
        """
        Compute sensitivity score for detected entities.
        Returns (score, level, explanation).
        """
        from .scorer import compute_sensitivity_score
        return compute_sensitivity_score(text, entities, firm_id)

    def get_active_engines(self) -> list[str]:
        """Return list of active detection engines."""
        engines = []
        if self._presidio_engine:
            engines.append("presidio")
        if self._gliner_model:
            engines.append("gliner")
        if self._custom_recognizers:
            engines.append("custom")
        return engines

    def _normalize_entity_type(self, label: str) -> str:
        """Normalize GLiNER labels to standard entity types."""
        mapping = {
            "person": "PERSON",
            "organization": "ORGANIZATION",
            "location": "LOCATION",
            "date": "DATE",
            "phone number": "PHONE_NUMBER",
            "email": "EMAIL",
            "credit card": "CREDIT_CARD",
            "social security number": "SSN",
            "monetary amount": "MONETARY_AMOUNT",
            "account number": "ACCOUNT_NUMBER",
            "ip address": "IP_ADDRESS",
            "medical record": "MEDICAL_RECORD",
            "passport number": "PASSPORT_NUMBER",
            "driver license": "DRIVERS_LICENSE",
        }
        return mapping.get(label.lower(), label.upper().replace(" ", "_"))

    def _merge_entities(self, entities: list[dict]) -> list[dict]:
        """Remove duplicate/overlapping entities, keeping highest confidence."""
        if not entities:
            return []

        sorted_entities = sorted(entities, key=lambda e: (e["start"], -e["confidence"]))
        merged = [sorted_entities[0]]

        for entity in sorted_entities[1:]:
            last = merged[-1]
            if entity["start"] < last["end"]:
                # Overlapping — keep higher confidence
                if entity["confidence"] > last["confidence"]:
                    merged[-1] = entity
            else:
                merged.append(entity)

        return merged

    def _boost_agreement(
        self, merged: list[dict], all_entities: list[dict]
    ) -> list[dict]:
        """Boost confidence when multiple engines detect the same entity."""
        for entity in merged:
            agreeing_sources = set()
            for other in all_entities:
                if (
                    abs(other["start"] - entity["start"]) <= 2
                    and abs(other["end"] - entity["end"]) <= 2
                    and other["type"] == entity["type"]
                ):
                    agreeing_sources.add(other["source"])

            if len(agreeing_sources) >= 2:
                # Multiple engines agree — boost confidence
                entity["confidence"] = min(1.0, entity["confidence"] * 1.3)

        return merged
