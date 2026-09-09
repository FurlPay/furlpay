"""Turn a provider's raw mempool payload into one transaction shape.

WRITTEN AGAINST A CAPTURED PAYLOAD, not against documentation. The shapes here
were sampled from the live blockchain.info feed on 2026-09-07, and two findings
changed the design:

  * `weight` IS NOT PRESENT on the websocket payload. Only `size` is. vsize and
    weight therefore cannot be read; they are ESTIMATED from the serialized size
    and named as estimates at every call site. Reporting a derived number as if
    it were observed is the failure mode this whole project exists to avoid.

  * `prev_out.value` IS present on every input, on every transaction sampled.
    That is what makes the fee computable with no extra request -- fee is total
    in minus total out. When an input lacks it the fee is None rather than a
    number computed from a partial sum, which would read as a real, small fee.
"""

from __future__ import annotations

from dataclasses import dataclass, field

SATS = 100_000_000


@dataclass(frozen=True)
class TxOutput:
    index: int
    value_sats: int
    address: str | None
    script_hex: str

    @property
    def btc(self) -> float:
        return self.value_sats / SATS

    @property
    def is_op_return(self) -> bool:
        # OP_RETURN is opcode 0x6a in the first byte of the scriptPubKey.
        return self.script_hex.startswith("6a")


@dataclass(frozen=True)
class TxInput:
    address: str | None
    value_sats: int | None
    script_hex: str
    sequence: int

    @property
    def is_rbf_signalled(self) -> bool:
        # BIP125: any input with sequence < 0xfffffffe signals opt-in RBF.
        return self.sequence < 0xFFFFFFFE


@dataclass(frozen=True)
class Transaction:
    txid: str
    size: int
    version: int
    lock_time: int
    inputs: list[TxInput]
    outputs: list[TxOutput]
    first_seen: int
    #: True when every input carried a previous-output value, which is what
    #: makes `fee_sats` a fact rather than a guess.
    inputs_fully_valued: bool = True
    extra: dict = field(default_factory=dict)

    # -- values ------------------------------------------------------------
    @property
    def total_out_sats(self) -> int:
        return sum(o.value_sats for o in self.outputs)

    @property
    def total_in_sats(self) -> int | None:
        if not self.inputs_fully_valued:
            return None
        return sum(i.value_sats or 0 for i in self.inputs)

    @property
    def total_out_btc(self) -> float:
        return self.total_out_sats / SATS

    @property
    def total_in_btc(self) -> float | None:
        t = self.total_in_sats
        return None if t is None else t / SATS

    @property
    def fee_sats(self) -> int | None:
        """Fee, or None when it cannot be known.

        A coinbase transaction has no meaningful fee here, and a partially
        valued input set gives a fee that is wrong in the dangerous direction --
        too large, because outputs are subtracted from an understated input
        total. Both return None.
        """
        total_in = self.total_in_sats
        if total_in is None:
            return None
        fee = total_in - self.total_out_sats
        return fee if fee >= 0 else None

    @property
    def fee_btc(self) -> float | None:
        f = self.fee_sats
        return None if f is None else f / SATS

    # -- weight ------------------------------------------------------------
    @property
    def vsize_estimate(self) -> int:
        """Virtual size, ESTIMATED from serialized size.

        The feed does not carry weight, so a true vsize is not available. For a
        non-segwit transaction vsize equals size exactly; for segwit this
        overstates, because witness bytes are discounted fourfold and this
        cannot see them. The name says estimate for that reason.
        """
        return max(1, self.size)

    @property
    def fee_rate_estimate(self) -> float | None:
        """sat/vB, estimated. None when the fee itself is unknown."""
        f = self.fee_sats
        return None if f is None else f / self.vsize_estimate

    # -- shape -------------------------------------------------------------
    @property
    def largest_output(self) -> TxOutput | None:
        spendable = [o for o in self.outputs if not o.is_op_return]
        return max(spendable, key=lambda o: o.value_sats, default=None)

    @property
    def largest_input_sats(self) -> int | None:
        vals = [i.value_sats for i in self.inputs if i.value_sats is not None]
        return max(vals) if vals else None

    @property
    def op_returns(self) -> list[TxOutput]:
        return [o for o in self.outputs if o.is_op_return]

    @property
    def signals_rbf(self) -> bool:
        return any(i.is_rbf_signalled for i in self.inputs)

    @property
    def input_addresses(self) -> set[str]:
        return {i.address for i in self.inputs if i.address}

    @property
    def output_addresses(self) -> set[str]:
        return {o.address for o in self.outputs if o.address}

    @property
    def explorer_url(self) -> str:
        return f"https://blockstream.info/tx/{self.txid}"


def script_type(script_hex: str) -> str:
    """Classify a scriptPubKey by its prefix.

    Deliberately prefix-matching rather than fully decoding: the goal is a label
    on an embed, and a confidently wrong label is worse than UNKNOWN.
    """
    s = (script_hex or "").lower()
    if s.startswith("6a"):
        return "OP_RETURN"
    if s.startswith("76a914") and s.endswith("88ac") and len(s) == 50:
        return "P2PKH"
    if s.startswith("a914") and s.endswith("87") and len(s) == 46:
        return "P2SH"
    if s.startswith("0014") and len(s) == 44:
        return "P2WPKH"
    if s.startswith("0020") and len(s) == 68:
        return "P2WSH"
    if s.startswith("5120") and len(s) == 68:
        return "P2TR"
    if s.startswith("41") and s.endswith("ac"):
        return "P2PK"
    return "UNKNOWN"


def script_types(tx: Transaction) -> dict[str, int]:
    counts: dict[str, int] = {}
    for o in tx.outputs:
        t = script_type(o.script_hex)
        counts[t] = counts.get(t, 0) + 1
    return counts


def parse_blockchain_info(payload: dict) -> Transaction | None:
    """Parse one {"op":"utx","x":{...}} message.

    Returns None rather than raising on anything unrecognised. A malformed
    message from a public feed must skip one transaction, never take the
    listener down -- the listener is the thing that has to survive.
    """
    x = payload.get("x") if payload.get("op") == "utx" else payload
    if not isinstance(x, dict):
        return None

    txid = x.get("hash")
    if not isinstance(txid, str) or len(txid) != 64:
        return None

    raw_inputs = x.get("inputs") or []
    raw_outputs = x.get("out") or []
    if not isinstance(raw_inputs, list) or not isinstance(raw_outputs, list):
        return None

    inputs: list[TxInput] = []
    fully_valued = True
    for i in raw_inputs:
        if not isinstance(i, dict):
            continue
        prev = i.get("prev_out") or {}
        value = prev.get("value")
        if not isinstance(value, int):
            # A coinbase input has no prev_out; so does a payload we do not
            # understand. Either way the fee stops being knowable.
            fully_valued = False
            value = None
        inputs.append(
            TxInput(
                address=prev.get("addr"),
                value_sats=value,
                script_hex=str(i.get("script") or ""),
                sequence=int(i.get("sequence") or 0),
            )
        )

    outputs: list[TxOutput] = []
    for o in raw_outputs:
        if not isinstance(o, dict):
            continue
        value = o.get("value")
        if not isinstance(value, int):
            continue
        outputs.append(
            TxOutput(
                index=int(o.get("n") or 0),
                value_sats=value,
                address=o.get("addr"),
                script_hex=str(o.get("script") or ""),
            )
        )

    if not outputs:
        return None
    if not inputs:
        fully_valued = False

    return Transaction(
        txid=txid,
        size=int(x.get("size") or 0),
        version=int(x.get("ver") or 0),
        lock_time=int(x.get("lock_time") or 0),
        inputs=inputs,
        outputs=outputs,
        first_seen=int(x.get("time") or 0),
        inputs_fully_valued=fully_valued,
    )
