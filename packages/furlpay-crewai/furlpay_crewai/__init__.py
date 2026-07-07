"""FurlPay tools for CrewAI — stablecoin payments, investing, and x402 agentic rails."""

from .client import FurlPayClient
from .tools import FurlPayTools, get_furlpay_tools

__version__ = "0.1.0"
__all__ = ["get_furlpay_tools", "FurlPayTools", "FurlPayClient", "__version__"]
