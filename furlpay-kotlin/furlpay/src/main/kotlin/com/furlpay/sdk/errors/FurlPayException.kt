package com.furlpay.sdk.errors

sealed class FurlPayException(message: String, cause: Throwable? = null) : Exception(message, cause)

class AuthenticationException(message: String) : FurlPayException(message)
class InvalidRequestException(message: String) : FurlPayException(message)
class PaymentException(message: String) : FurlPayException(message)
class NetworkException(message: String, cause: Throwable? = null) : FurlPayException(message, cause)
class RateLimitException(message: String) : FurlPayException(message)
class WebhookException(message: String) : FurlPayException(message)
