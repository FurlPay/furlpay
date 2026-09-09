class FurlPayError(Exception):
    """Base exception for FurlPay errors."""
    pass

class AuthenticationError(FurlPayError):
    """Raised when API key is missing or invalid."""
    pass

class InvalidRequestError(FurlPayError):
    """Raised when the request parameters are invalid."""
    pass

class PaymentError(FurlPayError):
    """Raised when a payment fails or cannot be processed."""
    pass
