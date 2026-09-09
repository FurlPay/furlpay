import pytest
from furlpay import FurlPay, AuthenticationError
from furlpay.constants import API_BASE_URL_PRODUCTION, API_BASE_URL_SANDBOX

def test_client_initialization():
    client = FurlPay(api_key="test_key")
    assert client.api_key == "test_key"
    assert client.base_url == API_BASE_URL_PRODUCTION
    
def test_client_sandbox():
    client = FurlPay(api_key="test_key", environment="sandbox")
    assert client.base_url == API_BASE_URL_SANDBOX

def test_client_missing_key():
    with pytest.raises(AuthenticationError):
        FurlPay(api_key="")
