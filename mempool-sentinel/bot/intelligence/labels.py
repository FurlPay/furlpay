"""Address intelligence: what we believe about an address, and who told us.

EVERY LABEL CARRIES ITS SOURCE AND A CONFIDENCE. That is the whole point of this
module. An address label is a claim made by somebody, not a property of the
blockchain, and the difference matters most in exactly the case this bot exists
for: telling an operator that funds touched a "known hack address" is an
accusation. It has to be traceable to whoever made it and qualified by how sure
they were.

Nothing here is populated from a third-party API at runtime. Labels come from
config/labels.json, which a human edits and reviews. An automatic feed would
make the bot repeat someone else's mistake at machine speed and under our name.

The file ships ESSENTIALLY EMPTY on purpose. A registry seeded with plausible
looking addresses nobody verified is worse than no registry: it produces
confident alerts about entities that were never checked, and the first time one
is wrong the whole feed stops being trusted.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("sentinel.labels")

CATEGORIES = {
    "EXCHANGE",
    "MINER",
    "ETF",
    "CUSTODIAN",
    "WHALE",
    "GOVERNMENT",
    "KNOWN_HACK",
    "KNOWN_EXPLOIT",
    "BRIDGE",
    "MIXER",
    "DEFI",
    "SERVICE",
    "PERSONAL_WALLET",
    "UNKNOWN",
}

#: Categories that assert wrongdoing by somebody. Alerts touching these get the
#: most careful wording, and a LOW-confidence label in one of them is reported
#: as unverified rather than stated.
ACCUSATORY = {"KNOWN_HACK", "KNOWN_EXPLOIT", "MIXER"}

CONFIDENCES = {"HIGH", "MEDIUM", "LOW"}


@dataclass(frozen=True)
class Label:
    address: str
    entity: str
    category: str
    source: str
    confidence: str
    notes: str = ""

    @property
    def is_accusatory(self) -> bool:
        return self.category in ACCUSATORY

    def describe(self) -> str:
        """One line for an embed, always naming the source.

        A reader must be able to see, without leaving Discord, that a label came
        from an internal note rather than a published attribution.
        """
        base = f"{self.entity} ({self.category})"
        return f"{base} - source: {self.source}, confidence: {self.confidence}"


class LabelStore:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._by_address: dict[str, Label] = {}
        self.load()

    def load(self) -> None:
        """Read labels from disk, skipping anything malformed.

        A bad entry drops that entry and logs it. Refusing to start because one
        label has a typo would take the monitor down for a data problem.
        """
        self._by_address = {}
        if not self._path.exists():
            log.warning("no label file at %s; running with no address labels", self._path)
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.error("could not read %s (%s); running with no address labels", self._path, exc)
            return

        for entry in raw.get("labels", []):
            if not isinstance(entry, dict):
                continue
            address = str(entry.get("address") or "").strip()
            category = str(entry.get("category") or "UNKNOWN").upper()
            confidence = str(entry.get("confidence") or "LOW").upper()
            source = str(entry.get("source") or "").strip()
            if not address:
                continue
            if category not in CATEGORIES:
                log.warning("label for %s has unknown category %r; skipped", address, category)
                continue
            if confidence not in CONFIDENCES:
                confidence = "LOW"
            if not source:
                # An unsourced label is exactly what this module refuses to
                # traffic in, so it is dropped rather than silently downgraded.
                log.warning("label for %s has no source; skipped", address)
                continue
            self._by_address[address] = Label(
                address=address,
                entity=str(entry.get("entity") or "unknown entity"),
                category=category,
                source=source,
                confidence=confidence,
                notes=str(entry.get("notes") or ""),
            )
        log.info("loaded %d address labels from %s", len(self._by_address), self._path)

    def get(self, address: str | None) -> Label | None:
        if not address:
            return None
        return self._by_address.get(address)

    def lookup_many(self, addresses: set[str]) -> list[Label]:
        found = [self._by_address[a] for a in addresses if a in self._by_address]
        return sorted(found, key=lambda label: label.address)

    def __len__(self) -> int:
        return len(self._by_address)


@dataclass(frozen=True)
class WatchEntry:
    address: str
    reason: str
    severity: str  # LOW | MEDIUM | HIGH | CRITICAL
    added: str = ""


class Watchlist:
    """Addresses an operator has explicitly asked to be told about.

    Kept separate from labels because it means something different: a label is a
    belief about who an address belongs to, a watch is an instruction to raise
    an alert. An address can be watched with no label at all.
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._entries: dict[str, WatchEntry] = {}
        self.load()

    def load(self) -> None:
        self._entries = {}
        if not self._path.exists():
            log.warning("no watchlist at %s; nothing is being watched", self._path)
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.error("could not read %s (%s); nothing is being watched", self._path, exc)
            return

        for entry in raw.get("addresses", []):
            if isinstance(entry, str):
                self._entries[entry] = WatchEntry(address=entry, reason="watchlisted", severity="MEDIUM")
                continue
            if not isinstance(entry, dict):
                continue
            address = str(entry.get("address") or "").strip()
            if not address:
                continue
            severity = str(entry.get("severity") or "MEDIUM").upper()
            if severity not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
                severity = "MEDIUM"
            self._entries[address] = WatchEntry(
                address=address,
                reason=str(entry.get("reason") or "watchlisted"),
                severity=severity,
                added=str(entry.get("added") or ""),
            )
        log.info("loaded %d watchlist addresses from %s", len(self._entries), self._path)

    def match(self, addresses: set[str]) -> list[WatchEntry]:
        hits = [self._entries[a] for a in addresses if a in self._entries]
        return sorted(hits, key=lambda e: e.address)

    def add(self, address: str, reason: str, severity: str = "MEDIUM") -> WatchEntry:
        """Add and persist. Used by the /watch command."""
        entry = WatchEntry(address=address, reason=reason, severity=severity.upper())
        self._entries[address] = entry
        self._persist()
        return entry

    def remove(self, address: str) -> bool:
        if address not in self._entries:
            return False
        del self._entries[address]
        self._persist()
        return True

    def _persist(self) -> None:
        payload = {
            "addresses": [
                {
                    "address": e.address,
                    "reason": e.reason,
                    "severity": e.severity,
                    "added": e.added,
                }
                for e in self._entries.values()
            ]
        }
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError as exc:
            log.error("could not persist watchlist to %s: %s", self._path, exc)

    def __len__(self) -> int:
        return len(self._entries)
