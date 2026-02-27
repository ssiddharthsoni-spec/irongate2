"""
IronGate Contextual Sensitivity Model - Training Pipeline
=========================================================

Usage:
    pip install scikit-learn numpy
    python train.py

Output:
    model_weights.json  - feature weights for browser inference
"""

import json
import re
import numpy as np
from collections import Counter
from pathlib import Path

# --- KEYWORD DICTIONARIES ---

LEGAL_KEYWORDS = {
    "attorney-client": 8, "privileged": 7, "work product": 8, "confidential": 5,
    "under seal": 9, "protective order": 8, "without prejudice": 6,
    "settlement": 6, "settle for": 8, "bottom line": 9, "opening position": 9,
    "mediation": 5, "arbitration": 4, "summary judgment": 5, "motion to": 4,
    "deposition": 6, "discovery": 5, "interrogatories": 5, "subpoena": 5,
    "strong case": 8, "weak case": 8, "exposure": 6, "liability": 5,
    "likelihood of success": 9, "risk of loss": 8, "smoking gun": 9,
    "our best argument": 8, "their weakness": 8,
    "acquisition": 4, "merger": 4, "purchase price": 7, "earnout": 7,
    "due diligence": 5, "closing conditions": 6, "break-up fee": 8,
    "letter of intent": 6, "term sheet": 5, "SPA": 5, "MAC clause": 7,
    "our client": 7, "the client wants": 8, "client's position": 8,
    "matter number": 6, "docket": 5, "case no": 5,
    "conflict of interest": 7, "ethics committee": 8, "disqualification": 7,
    "malpractice": 7, "bar complaint": 8,
}

FINANCE_KEYWORDS = {
    "earnings": 4, "revenue will": 8, "above consensus": 9, "below consensus": 9,
    "earnings call": 5, "pre-announcement": 9, "guidance": 4, "forecast": 4,
    "not yet disclosed": 9, "hasn't been announced": 9, "before the market": 8,
    "position": 3, "building a position": 8, "cost basis": 7, "our model suggests": 7,
    "upside": 4, "downside": 4, "short position": 7, "long position": 6,
    "catalyst": 5, "price target": 6, "stop loss": 5,
    "merger discussions": 9, "acquisition target": 8, "fairness opinion": 7,
    "premium to": 7, "tender offer": 8, "hostile bid": 9,
    "portfolio": 3, "allocation": 4, "AUM": 5, "redemption": 6,
    "wire transfer": 7, "IBAN": 8, "beneficiary": 5, "routing number": 8,
    "fund returned": 6, "net to investors": 7, "performance fee": 6,
    "investor letter": 6, "NAV": 5, "drawdown": 5,
    "front-running": 9, "insider trading": 9, "compliance investigation": 8,
    "personal account": 7, "restricted list": 8, "information barrier": 7,
    "IPO": 5, "pricing committee": 8, "roadshow": 6,
}

TECH_KEYWORDS = {
    "production database": 7, "connection string": 8, "internal.": 6,
    "admin panel": 6, "default credentials": 9, "root password": 9,
    ".internal.": 7, "secrets manager": 6, "vault": 4,
    "vulnerability": 5, "SQL injection": 8, "XSS": 7, "RCE": 9,
    "unpatched": 8, "zero-day": 9, "exploit": 7, "CVE-": 5,
    "haven't patched": 9, "been exposed": 8, "data breach": 7,
    "launching": 3, "roadmap": 5, "unreleased": 7, "before announcement": 8,
    "developer conference": 4, "product launch": 4, "beta": 3,
    "monthly active users": 5, "MAU": 5, "subscribers": 4, "churn": 5,
    "ARR": 6, "MRR": 6, "CAC": 6, "LTV": 5, "burn rate": 7,
    "runway": 6, "Series": 4,
    "our algorithm": 6, "proprietary": 5, "trade secret": 7,
    "recommendation engine": 5, "pricing formula": 8, "discount calculation": 7,
    "layoff": 8, "lay off": 8, "headcount reduction": 8, "RIF": 8,
    "severance": 6, "affected teams": 7,
}

HEALTHCARE_KEYWORDS = {
    "MRN": 8, "medical record": 7, "patient": 4, "DOB": 6,
    "date of birth": 6, "admission": 3, "discharge": 3,
    "room": 2, "bed": 2, "ward": 3,
    "diagnosed with": 5, "diagnosis": 4, "treatment": 3, "prescribed": 5,
    "medication": 3, "dosage": 4, "surgery": 3, "procedure": 3,
    "lab results": 5, "troponin": 5, "A1C": 4, "eGFR": 4,
    "MRI": 3, "CT scan": 3, "biopsy": 4,
    "psychiatric": 7, "mental health": 6, "suicidal": 8, "depression": 5,
    "eating disorder": 7, "substance abuse": 7, "rehab": 5,
    "sentinel event": 8, "wrong-site": 9, "medication error": 8,
    "adverse event": 6, "root cause analysis": 6, "complication rate": 7,
    "malpractice": 7, "peer review": 6,
    "clinical trial": 4, "Phase 3": 5, "Phase 2": 4, "NDA filing": 7,
    "FDA": 3, "efficacy": 4, "placebo": 3, "p-value": 4, "p=": 4,
    "undisclosed results": 9, "sponsor": 4,
    "denied coverage": 5, "appeal": 3, "prior authorization": 4,
    "CPT code": 4, "ICD-10": 4, "NPI": 5,
}

GENERAL_KEYWORDS = {
    "board voted": 7, "board resolution": 7, "terminate the CEO": 9,
    "interim CEO": 8, "press release": 4, "all-hands": 3,
    "potential sale": 8, "investment bank": 6, "data room": 7,
    "indicative range": 8, "strategic buyer": 7, "PE firm": 5,
    "engagement survey": 5, "morale": 4, "attrition": 5,
    "accepted offers from competitors": 8, "retention risk": 6,
    "enterprise agreement": 4, "discount": 3, "counteroffer": 6,
    "backup plan": 4, "migration": 3,
    "competitor": 4, "competitive intelligence": 7, "trade secret": 7,
    "poach": 7, "recruit from": 5,
}

INVESTMENT_BANKING_KEYWORDS = {
    "deal value": 8, "enterprise value": 5, "purchase price": 7,
    "earnout": 7, "holdback": 6, "break-up fee": 8, "reverse break": 9,
    "SPA": 5, "APA": 5, "stock purchase agreement": 6,
    "sources and uses": 6, "pro forma": 5, "accretion": 6, "dilution": 5,
    "project": 3, "Project ": 5, "codename": 8,
    "DCF": 3, "comparable companies": 4, "precedent transactions": 4,
    "EBITDA multiple": 5, "EV/EBITDA": 4, "fairness opinion": 7,
    "implied premium": 7, "football field": 5,
    "advisory fee": 8, "success fee": 8, "retainer": 5,
    "fee arrangement": 7, "engagement letter": 5, "tail period": 7,
    "IPO pricing": 8, "bookrunner": 7, "underwriting spread": 8,
    "greenshoe": 7, "overallotment": 7, "syndication": 6,
    "investor roadshow": 7, "pricing committee": 8,
    "leveraged buyout": 6, "LBO": 5, "sponsor": 4, "dry powder": 7,
    "IRR": 5, "multiple of money": 6, "recap": 5, "dividend recap": 8,
    "management rollover": 7, "co-invest": 6,
    "sell-side": 6, "buy-side": 5, "competitive auction": 7,
    "bid": 4, "indicative bid": 8, "final bid": 9,
    "management presentation": 5, "CIM": 5, "teaser": 6,
    "restructuring": 5, "debtor-in-possession": 8, "DIP financing": 9,
    "stalking horse": 8, "363 sale": 8, "creditor committee": 7,
    "material non-public": 9, "MNPI": 9, "information wall": 8,
    "restricted list": 8, "grey list": 8,
}

TECH_ENTERPRISE_KEYWORDS = {
    "source code": 6, "API key": 8, "secret key": 9, "access token": 7,
    "connection string": 8, "hardcoded": 7, "credentials": 6,
    "private key": 8, ".env": 7, "config file": 5,
    "microservice": 4, "production": 5, "staging": 4, "kubernetes": 4,
    "S3 bucket": 5, "AWS": 3, "GCP": 3, "Azure": 3,
    "us-east-1": 5, "us-west-2": 5, "IAM": 5,
    "service mesh": 5, "load balancer": 4,
    "vulnerability": 6, "CVE": 7, "zero-day": 9, "penetration test": 7,
    "security audit": 7, "SOC 2": 6, "unencrypted": 8,
    "data breach": 8, "incident response": 6, "MTTR": 5, "MTTD": 5,
    "PRD": 7, "product requirement": 6, "feature spec": 6,
    "launch date": 7, "codename": 7, "go-to-market": 7,
    "unreleased": 8, "beta": 3, "alpha": 4,
    "roadmap": 6, "Q1": 3, "Q2": 3, "Q3": 3, "Q4": 3,
    "ARR": 6, "MRR": 6, "churn": 5, "NPS": 5,
    "conversion rate": 5, "ARPU": 6, "LTV": 5, "CAC": 5,
    "burn rate": 7, "runway": 6, "pricing": 4,
    "competitive analysis": 7, "market share": 6, "switching to": 5,
    "losing customers": 7, "win rate": 6,
    "headcount": 5, "hiring plan": 6, "budget": 4,
    "rewrite": 4, "migration": 4, "deprecate": 5,
}


def extract_keyword_features(text):
    text_lower = text.lower()
    features = {}
    for name, keywords in [
        ("legal", LEGAL_KEYWORDS), ("finance", FINANCE_KEYWORDS),
        ("tech", TECH_KEYWORDS), ("healthcare", HEALTHCARE_KEYWORDS),
        ("general", GENERAL_KEYWORDS), ("investment_banking", INVESTMENT_BANKING_KEYWORDS),
        ("tech_enterprise", TECH_ENTERPRISE_KEYWORDS),
    ]:
        total_weight = 0
        matched_count = 0
        max_weight = 0
        for keyword, weight in keywords.items():
            if keyword.lower() in text_lower:
                total_weight += weight
                matched_count += 1
                max_weight = max(max_weight, weight)
        features[f"{name}_total_weight"] = total_weight
        features[f"{name}_match_count"] = matched_count
        features[f"{name}_max_weight"] = max_weight
    return features


def extract_structural_features(text):
    features = {}
    features["char_count"] = len(text)
    features["word_count"] = len(text.split())
    features["sentence_count"] = max(1, len(re.split(r'[.!?]+', text)))

    code_indicators = [
        r'function\s+\w+\s*\(', r'const\s+\w+\s*=', r'import\s+',
        r'class\s+\w+', r'def\s+\w+', r'=>\s*\{', r'require\(',
        r'\bif\s*\(', r'return\s+', r'\.then\(', r'async\s+',
    ]
    features["has_code"] = int(any(re.search(p, text) for p in code_indicators))

    money_pattern = r'\$[\d,]+(?:\.\d+)?(?:\s*(?:M|B|K|million|billion|thousand))?'
    features["money_count"] = len(re.findall(money_pattern, text))
    features["percentage_count"] = len(re.findall(r'\d+(?:\.\d+)?%', text))
    features["proper_noun_count"] = len(re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+', text))
    features["is_question"] = int(text.strip().endswith('?'))
    features["has_imperative"] = int(bool(re.match(
        r'^(Draft|Prepare|Write|Create|Help|Summarize|Review|Analyze|Explain|Compare|List)', text.strip()
    )))
    features["has_specific_numbers"] = int(bool(re.search(r'\b\d{3,}\b', text)))
    features["has_dates"] = int(bool(re.search(
        r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}', text
    )))
    features["has_names"] = int(bool(re.search(r'(?:Mr\.|Mrs\.|Ms\.|Dr\.|Partner|Client)\s+[A-Z][a-z]+', text)))

    conf_markers = [
        "confidential", "privileged", "do not distribute", "internal only",
        "under NDA", "not yet", "hasn't been", "haven't", "before the",
        "undisclosed", "not public", "embargo",
    ]
    features["confidentiality_markers"] = sum(1 for m in conf_markers if m.lower() in text.lower())

    urgency = ["today", "tomorrow", "this week", "next week", "immediately", "urgent", "ASAP"]
    features["urgency_markers"] = sum(1 for u in urgency if u.lower() in text.lower())

    pii_patterns = {
        "ssn": r'\b\d{3}-\d{2}-\d{4}\b',
        "email": r'\b[\w.-]+@[\w.-]+\.\w+\b',
        "phone": r'\b(?:\+1\s?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b',
        "credit_card": r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b',
        "ip_address": r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',
        "api_key": r'\b(?:sk-|ghp_|gho_|xoxb-|AKIA)[A-Za-z0-9]+',
        "db_uri": r'(?:postgres|mysql|mongodb|redis)://',
    }
    pii_types_found = sum(1 for p in pii_patterns.values() if re.search(p, text))
    features["pii_type_count"] = pii_types_found
    features["pii_cooccurrence"] = int(pii_types_found >= 2)
    return features


def extract_all_features(text):
    features = {}
    features.update(extract_keyword_features(text))
    features.update(extract_structural_features(text))
    return features


# --- TRAINING ---

def softmax(z):
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


class StandardScaler:
    def __init__(self):
        self.mean_ = None
        self.scale_ = None

    def fit_transform(self, X):
        self.mean_ = X.mean(axis=0)
        self.scale_ = X.std(axis=0)
        self.scale_[self.scale_ == 0] = 1.0
        return (X - self.mean_) / self.scale_


def multinomial_logistic_regression(X, y, n_classes=3, lr=0.1, epochs=500, C=1.0):
    n_samples, n_features = X.shape
    counts = np.bincount(y, minlength=n_classes)
    weights = n_samples / (n_classes * counts.astype(float))
    sample_weights = weights[y]

    np.random.seed(42)
    W = np.random.randn(n_classes, n_features) * 0.01
    b = np.zeros(n_classes)

    Y_onehot = np.zeros((n_samples, n_classes))
    Y_onehot[np.arange(n_samples), y] = 1.0

    for epoch in range(epochs):
        logits = X @ W.T + b
        probs = softmax(logits)
        error = (probs - Y_onehot) * sample_weights[:, None]
        grad_W = (error.T @ X) / n_samples + (1.0 / C) * W
        grad_b = error.mean(axis=0)
        W -= lr * grad_W
        b -= lr * grad_b

        if epoch % 100 == 0:
            loss = -np.sum(sample_weights * np.log(probs[np.arange(n_samples), y] + 1e-10)) / n_samples
            pred = probs.argmax(axis=1)
            acc = (pred == y).mean()
            print(f"  Epoch {epoch:4d} | Loss: {loss:.4f} | Accuracy: {acc:.3f}")

    return W, b


def stratified_k_fold(y, k=5, seed=42):
    rng = np.random.RandomState(seed)
    classes = np.unique(y)
    folds = [[] for _ in range(k)]
    for c in classes:
        idx = np.where(y == c)[0]
        rng.shuffle(idx)
        for i, ix in enumerate(idx):
            folds[i % k].append(ix)
    return [np.array(f) for f in folds]


if __name__ == "__main__":
    dataset_path = Path(__file__).parent / "dataset.json"
    model_path = Path(__file__).parent / "model_weights.json"

    print("=" * 60)
    print("IronGate Contextual Sensitivity Model - Training")
    print("=" * 60)

    with open(dataset_path) as f:
        data = json.load(f)
    examples = data["examples"]
    print(f"Loaded {len(examples)} examples")

    labels = Counter(e["label"] for e in examples)
    print(f"Labels: {dict(labels)}")

    feature_dicts = [extract_all_features(e["prompt"]) for e in examples]
    feature_names = sorted(feature_dicts[0].keys())

    X = np.array([[fd[fn] for fn in feature_names] for fd in feature_dicts])
    label_map = {"SAFE": 0, "SENSITIVE": 1, "CRITICAL": 2}
    y = np.array([label_map[e["label"]] for e in examples])

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 5-fold cross-validation
    folds = stratified_k_fold(y, k=5)
    cv_scores = []
    for i in range(5):
        val_idx = folds[i]
        train_idx = np.concatenate([folds[j] for j in range(5) if j != i])
        X_train, X_val = X_scaled[train_idx], X_scaled[val_idx]
        y_train, y_val = y[train_idx], y[val_idx]
        W, b = multinomial_logistic_regression(X_train, y_train, epochs=500)
        logits = X_val @ W.T + b
        preds = logits.argmax(axis=1)
        acc = (preds == y_val).mean()
        cv_scores.append(acc)
        print(f"  Fold {i+1}: accuracy = {acc:.3f}")

    cv_scores = np.array(cv_scores)
    print(f"\nCV accuracy: {cv_scores.mean():.3f} (+/- {cv_scores.std():.3f})")

    # Train final model
    print("\nTraining final model on all data...")
    W, b = multinomial_logistic_regression(X_scaled, y, epochs=800)

    logits = X_scaled @ W.T + b
    y_pred = logits.argmax(axis=1)
    print(f"Final training accuracy: {(y_pred == y).mean():.3f}")

    # Per-class metrics
    class_names = ["SAFE", "SENSITIVE", "CRITICAL"]
    print(f"\n{'Class':>12s}  {'Prec':>6s}  {'Rec':>6s}  {'F1':>6s}")
    for c in range(3):
        tp = ((y_pred == c) & (y == c)).sum()
        fp = ((y_pred == c) & (y != c)).sum()
        fn = ((y_pred != c) & (y == c)).sum()
        p = tp / (tp + fp) if (tp + fp) > 0 else 0
        r = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0
        print(f"{class_names[c]:>12s}  {p:>6.3f}  {r:>6.3f}  {f1:>6.3f}")

    # Export
    weights = {
        "metadata": {
            "version": "1.0.0",
            "type": "logistic_regression_multinomial",
            "classes": class_names,
            "feature_count": len(feature_names),
            "cv_accuracy": float(cv_scores.mean()),
            "cv_std": float(cv_scores.std()),
        },
        "feature_names": feature_names,
        "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "coefficients": {
            "SAFE": W[0].tolist(), "SENSITIVE": W[1].tolist(), "CRITICAL": W[2].tolist(),
        },
        "intercepts": {"SAFE": float(b[0]), "SENSITIVE": float(b[1]), "CRITICAL": float(b[2])},
        "keyword_dictionaries": {
            "legal": LEGAL_KEYWORDS, "finance": FINANCE_KEYWORDS,
            "tech": TECH_KEYWORDS, "healthcare": HEALTHCARE_KEYWORDS,
            "general": GENERAL_KEYWORDS, "investment_banking": INVESTMENT_BANKING_KEYWORDS,
            "tech_enterprise": TECH_ENTERPRISE_KEYWORDS,
        },
    }

    with open(model_path, "w") as f:
        json.dump(weights, f, indent=2)

    size_kb = model_path.stat().st_size / 1024
    print(f"\nModel exported to {model_path} ({size_kb:.1f} KB)")
    print("Done!")
