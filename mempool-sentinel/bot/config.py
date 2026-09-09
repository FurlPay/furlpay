"""Configuration, read once from the environment.

Every threshold the operator is likely to want to change is here rather than
inline, because a monitoring system whose sensitivity is buried in the detector
is one nobody re-tunes after the first noisy night.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _str(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


@dataclass(frozen=True)
class Thresholds:
    """BTC values at which a transaction becomes worth a human's attention.

    These are denominated in BTC rather than USD because the BTC figure is the
    fact and the USD figure is an estimate derived from a price feed that can be
    stale or absent. A threshold that moves when a price API hiccups is a
    threshold that cannot be reasoned about.
    """

    whale: float = 100.0
    mega: float = 500.0
    ultra: float = 1000.0
    critical: float = 5000.0

    def tier(self, btc: float) -> str | None:
        if btc >= self.critical:
            return "CRITICAL_WHALE"
        if btc >= self.ultra:
            return "ULTRA_WHALE"
        if btc >= self.mega:
            return "MEGA_WHALE"
        if btc >= self.whale:
            return "WHALE"
        return None


@dataclass(frozen=True)
class Config:
    discord_token: str
    guild_id: int
    channel_name: str
    category_name: str

    provider: str
    esplora_api: str
    blockchain_ws: str

    thresholds: Thresholds

    # An OP_RETURN alone is not news: 28% of mempool transactions carried one
    # when this was measured on 2026-09-07. It is reported when it accompanies a
    # transaction that already earned an alert, or when the payload is readable
    # text above this length -- never merely because the output exists.
    opreturn_min_text: int
    opreturn_min_btc: float

    price_ttl_seconds: int
    dedup_ttl_seconds: int
    state_path: str

    log_level: str
    dry_run: bool

    watchlist_path: str = "config/watchlist.json"
    labels_path: str = "config/labels.json"

    extra: dict[str, str] = field(default_factory=dict)

    @staticmethod
    def load() -> "Config":
        return Config(
            discord_token=_str("DISCORD_TOKEN") or _str("DISCORD_BOT_TOKEN"),
            guild_id=_int("DISCORD_GUILD_ID", 0),
            channel_name=_str("MEMPOOL_CHANNEL_NAME", "mempool"),
            category_name=_str("MEMPOOL_CATEGORY_NAME", "CHAINTRACKER"),
            provider=_str("BITCOIN_PROVIDER", "blockchain_info"),
            esplora_api=_str("ESPLORA_API_URL", "https://blockstream.info/api"),
            blockchain_ws=_str("BLOCKCHAIN_WS_URL", "wss://ws.blockchain.info/inv"),
            thresholds=Thresholds(
                whale=_float("WHALE_ALERT_BTC", 100.0),
                mega=_float("MEGA_WHALE_ALERT_BTC", 500.0),
                ultra=_float("ULTRA_WHALE_ALERT_BTC", 1000.0),
                critical=_float("CRITICAL_WHALE_ALERT_BTC", 5000.0),
            ),
            opreturn_min_text=_int("OPRETURN_MIN_TEXT_CHARS", 12),
            opreturn_min_btc=_float("OPRETURN_MIN_BTC", 10.0),
            price_ttl_seconds=_int("PRICE_TTL_SECONDS", 300),
            dedup_ttl_seconds=_int("DEDUP_TTL_SECONDS", 86_400),
            state_path=_str("STATE_PATH", "data/sentinel.sqlite3"),
            log_level=_str("LOG_LEVEL", "INFO").upper(),
            dry_run=_str("DRY_RUN", "").lower() in {"1", "true", "yes"},
        )

    def missing(self) -> list[str]:
        """What is absent that would stop the bot posting. Checked before
        connecting, so a misconfiguration fails at startup rather than at the
        moment the first whale appears."""
        gaps: list[str] = []
        if not self.discord_token:
            gaps.append("DISCORD_TOKEN")
        if not self.guild_id:
            gaps.append("DISCORD_GUILD_ID")
        return gaps
