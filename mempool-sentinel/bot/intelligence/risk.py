"""Decide whether a transaction deserves a human's attention, and say why.

TWO RULES SHAPE THIS ENTIRE MODULE.

1. OBSERVED FACTS AND INTERPRETATION ARE SEPARATE FIELDS, never one sentence.
   "3,998 BTC moved from A to B" is a fact. "B is associated with a reported
   exploit" is an interpretation of a label somebody else assigned. An alert
   that fuses them produces "3,998 BTC stolen", which is a claim this bot is not
   entitled to make and cannot retract once it is in a channel.

2. THE SCORE IS A TRIAGE ORDER, NOT A VERDICT. It answers "which of tonight's
   forty alerts should a person open first". It does not answer "is this
   criminal". Every consumer of `Assessment.score` is expected to treat it that
   way, and the wording helpers below make the safe phrasing the easy one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from bot.bitcoin.parser import Transaction
from bot.config import Thresholds
from bot.intelligence.labels import Label, LabelStore, WatchEntry, Watchlist
from bot.intelligence.opreturn import OpReturnPayload, decode, is_noteworthy

SEVERITIES = ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL")


@dataclass(frozen=True)
class Signal:
    """One reason a transaction scored, kept as a fact and a reading of it.

    `observed` must be checkable against the transaction by anybody reading the
    embed. `interpretation` is allowed to be a judgement, and is allowed to be
    None -- most signals do not need one, and inventing one is how a monitoring
    tool starts editorialising.
    """

    code: str
    points: int
    observed: str
    interpretation: str | None = None


@dataclass
class Assessment:
    tx: Transaction
    signals: list[Signal] = field(default_factory=list)
    labels: list[Label] = field(default_factory=list)
    watch_hits: list[WatchEntry] = field(default_factory=list)
    op_returns: list[OpReturnPayload] = field(default_factory=list)
    classification: str = "Transaction"

    @property
    def score(self) -> int:
        return sum(s.points for s in self.signals)

    @property
    def severity(self) -> str:
        """Bucket the score.

        A watchlist hit floors the severity at whatever the operator set, since
        they asked to be told about that address and a low-value movement of a
        watched address is exactly the thing they asked for.
        """
        floor = "INFO"
        for hit in self.watch_hits:
            if SEVERITIES.index(hit.severity) > SEVERITIES.index(floor):
                floor = hit.severity

        s = self.score
        if s >= 80:
            scored = "CRITICAL"
        elif s >= 60:
            scored = "HIGH"
        elif s >= 40:
            scored = "MEDIUM"
        elif s >= 20:
            scored = "LOW"
        else:
            scored = "INFO"

        return scored if SEVERITIES.index(scored) >= SEVERITIES.index(floor) else floor

    @property
    def is_alertable(self) -> bool:
        return bool(self.signals) and self.severity != "INFO"

    @property
    def observed_lines(self) -> list[str]:
        return [s.observed for s in self.signals]

    @property
    def interpretation_lines(self) -> list[str]:
        return [s.interpretation for s in self.signals if s.interpretation]


def _fmt_btc(btc: float) -> str:
    return f"{btc:,.4f}".rstrip("0").rstrip(".") + " BTC"


class RiskEngine:
    """Scores one transaction at a time.

    Deliberately stateless with respect to history: everything it needs is the
    transaction plus the two operator-curated stores. Behavioural detectors that
    need history (dormant wallets, peeling chains) belong in a later phase with
    a real store behind them, and are absent here rather than approximated --
    a "dormant whale" alert computed from no history would be a fabrication.
    """

    def __init__(
        self,
        thresholds: Thresholds,
        labels: LabelStore,
        watchlist: Watchlist,
        opreturn_min_text: int = 12,
        opreturn_min_btc: float = 10.0,
    ) -> None:
        self.thresholds = thresholds
        self.labels = labels
        self.watchlist = watchlist
        self.opreturn_min_text = opreturn_min_text
        self.opreturn_min_btc = opreturn_min_btc

    def assess(self, tx: Transaction) -> Assessment:
        a = Assessment(tx=tx)
        value = tx.total_out_btc
        addresses = tx.input_addresses | tx.output_addresses

        # -- value ---------------------------------------------------------
        tier = self.thresholds.tier(value)
        if tier:
            points = {
                "WHALE": 25,
                "MEGA_WHALE": 35,
                "ULTRA_WHALE": 45,
                "CRITICAL_WHALE": 60,
            }[tier]
            a.signals.append(
                Signal(
                    code=tier,
                    points=points,
                    observed=f"Transaction moves {_fmt_btc(value)} across {len(tx.outputs)} output(s).",
                )
            )
            a.classification = tier.replace("_", " ").title()

        # -- watchlist -----------------------------------------------------
        a.watch_hits = self.watchlist.match(addresses)
        for hit in a.watch_hits:
            a.signals.append(
                Signal(
                    code="WATCHLIST",
                    points=30,
                    observed=f"Address {hit.address} appears in this transaction.",
                    interpretation=f"On the operator watchlist: {hit.reason}.",
                )
            )

        # -- labels --------------------------------------------------------
        a.labels = self.labels.lookup_many(addresses)
        for label in a.labels:
            if label.is_accusatory:
                # The wording carries the confidence because a LOW-confidence
                # hack attribution and a HIGH-confidence one are different
                # claims, and only one of them should read as settled.
                hedge = {
                    "HIGH": "is attributed to",
                    "MEDIUM": "has been reported as associated with",
                    "LOW": "has an unverified reported association with",
                }[label.confidence]
                a.signals.append(
                    Signal(
                        code=f"LABEL_{label.category}",
                        points={"HIGH": 30, "MEDIUM": 20, "LOW": 10}[label.confidence],
                        observed=f"Address {label.address} appears in this transaction.",
                        interpretation=(
                            f"This address {hedge} {label.entity} "
                            f"({label.category}); source: {label.source}. Requires investigation."
                        ),
                    )
                )
            elif label.category == "EXCHANGE":
                direction = "deposit into" if label.address in tx.output_addresses else "withdrawal from"
                a.signals.append(
                    Signal(
                        code="EXCHANGE_INTERACTION",
                        points=20,
                        observed=f"Address {label.address} appears in this transaction.",
                        interpretation=(
                            f"Labelled as {label.entity}; consistent with a {direction} "
                            f"that service. Source: {label.source}."
                        ),
                    )
                )

        # -- structure -----------------------------------------------------
        if len(tx.inputs) >= 100:
            a.signals.append(
                Signal(
                    code="CONSOLIDATION",
                    points=15,
                    observed=f"{len(tx.inputs)} inputs spent into {len(tx.outputs)} output(s).",
                    interpretation="Shape is consistent with UTXO consolidation. Intent is not observable.",
                )
            )
        if len(tx.outputs) >= 20 and value >= self.thresholds.whale:
            a.signals.append(
                Signal(
                    code="FAN_OUT",
                    points=15,
                    observed=f"{_fmt_btc(value)} split across {len(tx.outputs)} outputs.",
                    interpretation="Shape is consistent with a distribution or batched payout.",
                )
            )

        # -- fee -----------------------------------------------------------
        rate = tx.fee_rate_estimate
        if rate is not None and rate >= 500:
            a.signals.append(
                Signal(
                    code="EXTREME_FEE",
                    points=10,
                    observed=f"Estimated fee rate {rate:,.0f} sat/vB ({_fmt_btc(tx.fee_btc or 0)}).",
                    interpretation="Unusually high fee. Often urgency, an error, or a fee-bump.",
                )
            )

        # -- OP_RETURN -----------------------------------------------------
        # Only inspected when the transaction is already interesting or large
        # enough to matter. 28% of mempool transactions carry an OP_RETURN, so
        # scanning every one of them is how this channel would become unreadable.
        if a.signals or value >= self.opreturn_min_btc:
            for out in tx.op_returns:
                payload = decode(out.script_hex)
                if payload and is_noteworthy(payload, self.opreturn_min_text):
                    a.op_returns.append(payload)
                    if payload.is_encrypted:
                        a.signals.append(
                            Signal(
                                code="OPRETURN_ENCRYPTED",
                                points=15,
                                observed="Transaction carries a PGP-armoured OP_RETURN payload.",
                                interpretation="Encrypted message. Contents not decrypted.",
                            )
                        )
                    else:
                        a.signals.append(
                            Signal(
                                code="OPRETURN_TEXT",
                                points=10,
                                observed=f"Transaction carries a readable OP_RETURN payload ({payload.byte_length} bytes).",
                            )
                        )

        if a.watch_hits and a.classification == "Transaction":
            a.classification = "Watchlist Match"
        return a
