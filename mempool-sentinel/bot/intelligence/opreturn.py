"""Decode OP_RETURN payloads into something a human can read, or say nothing.

OP_RETURN IS NOT NEWS BY ITSELF. Measured on the live feed 2026-09-07: 19 of 68
consecutive mempool transactions carried an OP_RETURN output -- 28%. A bot that
alerts on every one is a bot nobody reads by the second hour. Most of that
volume is protocol machinery: Runestones, ordinals envelopes, Omni, Stacks,
exchange batch markers. It is structured binary that happens to decode to
mojibake, not a message anyone wrote.

So this module answers a narrower question than "is there an OP_RETURN": it
answers "is there READABLE TEXT here that a person plausibly intended another
person to read". The caller pairs that with a value threshold before alerting.

Never decrypts anything. If a payload is PGP-armoured it is reported as
encrypted and left alone -- see `PGP_ARMOR`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

PGP_ARMOR = "-----BEGIN PGP MESSAGE-----"

#: Known protocol prefixes, so machine payloads are named rather than shown as
#: garbled text. Bytes are matched on the hex AFTER the OP_RETURN opcode and its
#: push opcode, which is why these are checked against the decoded payload.
PROTOCOL_MARKERS: tuple[tuple[bytes, str], ...] = (
    (b"RUNE_TEST", "Runes (test)"),
    (b"omni", "Omni Layer"),
    (b"X2", "Stacks"),
    (b"id", "Ordinals/inscription-adjacent"),
    (b"DOGE", "Doge bridge marker"),
    (b"\x6f\x6d\x6e\x69", "Omni Layer"),
)

#: Printable ASCII plus the handful of whitespace characters that appear in real
#: messages. Anything outside this is treated as binary.
_PRINTABLE = re.compile(rb"^[\x09\x0a\x0d\x20-\x7e]+$")


@dataclass(frozen=True)
class OpReturnPayload:
    """One decoded OP_RETURN output.

    `text` is only ever set when the payload really is readable text. A caller
    that wants to show something to a human checks `is_readable_text`; one that
    wants to know what protocol produced it checks `protocol`.
    """

    raw_hex: str
    data: bytes
    text: str | None
    protocol: str | None
    is_encrypted: bool

    @property
    def is_readable_text(self) -> bool:
        return self.text is not None

    @property
    def byte_length(self) -> int:
        return len(self.data)


def _strip_push_opcodes(script: bytes) -> bytes:
    """Remove OP_RETURN and the data-push opcode, leaving the payload.

    Bitcoin scripts push data with a length prefix: a single byte for lengths up
    to 75, then OP_PUSHDATA1/2/4 for longer. Leaving those bytes in place puts a
    stray control character at the front of every decoded string, which is
    exactly the sort of thing that makes a clean payload fail a printability
    check for no real reason.
    """
    if not script or script[0] != 0x6A:
        return b""
    body = script[1:]
    if not body:
        return b""
    op = body[0]
    if op <= 75:
        return body[1 : 1 + op]
    if op == 0x4C and len(body) >= 2:  # OP_PUSHDATA1
        return body[2 : 2 + body[1]]
    if op == 0x4D and len(body) >= 3:  # OP_PUSHDATA2
        length = int.from_bytes(body[1:3], "little")
        return body[3 : 3 + length]
    if op == 0x4E and len(body) >= 5:  # OP_PUSHDATA4
        length = int.from_bytes(body[1:5], "little")
        return body[5 : 5 + length]
    return body


def decode(script_hex: str) -> OpReturnPayload | None:
    """Decode one OP_RETURN scriptPubKey. None if it is not an OP_RETURN."""
    try:
        script = bytes.fromhex(script_hex)
    except ValueError:
        return None
    if not script or script[0] != 0x6A:
        return None

    data = _strip_push_opcodes(script)

    protocol: str | None = None
    for marker, name in PROTOCOL_MARKERS:
        if data.startswith(marker):
            protocol = name
            break

    text: str | None = None
    is_encrypted = False

    if _PRINTABLE.match(data):
        try:
            candidate = data.decode("utf-8").strip()
        except UnicodeDecodeError:
            candidate = ""
        if candidate:
            is_encrypted = PGP_ARMOR in candidate
            # A payload that is entirely hex characters is far more likely to be
            # an identifier than a sentence, and reads as noise in an embed.
            looks_like_hex_blob = (
                len(candidate) >= 16
                and all(c in "0123456789abcdefABCDEF" for c in candidate)
            )
            if not looks_like_hex_blob:
                text = candidate

    return OpReturnPayload(
        raw_hex=script_hex,
        data=data,
        text=text,
        protocol=protocol,
        is_encrypted=is_encrypted,
    )


def is_noteworthy(payload: OpReturnPayload, min_chars: int) -> bool:
    """Whether this payload is worth a human's attention on its own.

    Encrypted payloads always are -- somebody deliberately put a PGP message in
    a Bitcoin transaction, and that is unusual regardless of length. Otherwise
    it must be readable text of at least `min_chars`, which is what separates a
    sentence from a four-character protocol tag.
    """
    if payload.is_encrypted:
        return True
    if payload.text is None:
        return False
    if payload.protocol is not None:
        return False
    return len(payload.text) >= min_chars
