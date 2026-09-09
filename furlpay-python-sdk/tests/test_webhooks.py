import pytest
import hmac
import hashlib
from furlpay import FurlPay
from furlpay.errors import FurlPayError

def test_verify_signature_valid():
    client = FurlPay(api_key="test")
    payload = '{"id": "evt_123", "type": "payment.succeeded"}'
    secret = "whsec_test"
    
    valid_signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    assert client.webhooks.verify_signature(payload, valid_signature, secret) == True

def test_verify_signature_invalid():
    client = FurlPay(api_key="test")
    payload = '{"id": "evt_123", "type": "payment.succeeded"}'
    secret = "whsec_test"
    
    invalid_signature = "bad_signature"
    
    assert client.webhooks.verify_signature(payload, invalid_signature, secret) == False

def test_construct_event_invalid_signature():
    client = FurlPay(api_key="test")
    with pytest.raises(FurlPayError):
        client.webhooks.construct_event("payload", "bad_sig", "secret")
