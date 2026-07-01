//! Official Furlpay server-side SDK for Rust.
//!
//! Includes dependency-free webhook signature verification (HMAC-SHA256) that
//! matches the Node, Python and Go SDKs, plus a lightweight typed client
//! surface. HTTP transport is intentionally left to the integrator.

mod sha256;

use std::time::{SystemTime, UNIX_EPOCH};

const TOLERANCE_SECONDS: i64 = 300;

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; sha256::OUTPUT_SIZE] {
    let mut block_key = [0u8; sha256::BLOCK_SIZE];
    if key.len() > sha256::BLOCK_SIZE {
        let hashed = sha256::digest(key);
        block_key[..hashed.len()].copy_from_slice(&hashed);
    } else {
        block_key[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; sha256::BLOCK_SIZE];
    let mut opad = [0x5cu8; sha256::BLOCK_SIZE];
    for i in 0..sha256::BLOCK_SIZE {
        ipad[i] ^= block_key[i];
        opad[i] ^= block_key[i];
    }

    let mut inner = ipad.to_vec();
    inner.extend_from_slice(message);
    let inner_hash = sha256::digest(&inner);

    let mut outer = opad.to_vec();
    outer.extend_from_slice(&inner_hash);
    sha256::digest(&outer)
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

/// Errors returned while verifying a webhook signature.
#[derive(Debug, PartialEq, Eq)]
pub enum WebhookError {
    MissingHeader,
    MalformedHeader,
    TimestampOutOfTolerance,
    SignatureMismatch,
}

impl std::fmt::Display for WebhookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            WebhookError::MissingHeader => "missing furlpay-signature header",
            WebhookError::MalformedHeader => "malformed furlpay-signature header",
            WebhookError::TimestampOutOfTolerance => "signature timestamp outside tolerance",
            WebhookError::SignatureMismatch => "signature verification failed",
        };
        write!(f, "{}", msg)
    }
}

impl std::error::Error for WebhookError {}

/// Produce a `furlpay-signature` header value.
pub fn sign_payload(body: &str, secret: &str, timestamp: Option<i64>) -> String {
    let ts = timestamp.unwrap_or_else(now);
    let signed = format!("{}.{}", ts, body);
    let mac = hmac_sha256(secret.as_bytes(), signed.as_bytes());
    format!("t={},v1={}", ts, to_hex(&mac))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Verify a signature header. On success returns the raw (verified) body so the
/// caller can deserialize it with their JSON library of choice.
pub fn construct_event(body: &str, signature_header: Option<&str>, secret: &str) -> Result<String, WebhookError> {
    let header = signature_header.ok_or(WebhookError::MissingHeader)?;

    let mut ts: Option<i64> = None;
    let mut v1: Option<&str> = None;
    for part in header.split(',') {
        let mut kv = part.trim().splitn(2, '=');
        match (kv.next(), kv.next()) {
            (Some("t"), Some(val)) => ts = val.parse().ok(),
            (Some("v1"), Some(val)) => v1 = Some(val),
            _ => {}
        }
    }

    let ts = ts.ok_or(WebhookError::MalformedHeader)?;
    let v1 = v1.ok_or(WebhookError::MalformedHeader)?;

    if (now() - ts).abs() > TOLERANCE_SECONDS {
        return Err(WebhookError::TimestampOutOfTolerance);
    }

    let expected = to_hex(&hmac_sha256(secret.as_bytes(), format!("{}.{}", ts, body).as_bytes()));
    if !constant_time_eq(expected.as_bytes(), v1.as_bytes()) {
        return Err(WebhookError::SignatureMismatch);
    }

    Ok(body.to_string())
}

/// Minimal typed client config. Bring your own HTTP transport.
pub struct Furlpay {
    pub api_key: String,
    pub base_url: String,
}

impl Furlpay {
    pub fn new(api_key: impl Into<String>) -> Self {
        Furlpay { api_key: api_key.into(), base_url: "https://api.furlpay.app".to_string() }
    }

    /// Authorization header value for outbound requests.
    pub fn auth_header(&self) -> String {
        format!("Bearer {}", self.api_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vector() {
        // SHA-256("abc")
        let d = sha256::digest(b"abc");
        assert_eq!(to_hex(&d), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let body = "{\"type\":\"deposit.settled\"}";
        let sig = sign_payload(body, "whsec_test", Some(now()));
        assert!(construct_event(body, Some(&sig), "whsec_test").is_ok());
    }

    #[test]
    fn rejects_tampered_signature() {
        let body = "{\"type\":\"x\"}";
        let sig = sign_payload(body, "whsec_test", Some(now()));
        assert_eq!(
            construct_event("{\"type\":\"y\"}", Some(&sig), "whsec_test"),
            Err(WebhookError::SignatureMismatch)
        );
    }
}
