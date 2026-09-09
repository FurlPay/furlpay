from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class CreatePaymentParams(BaseModel):
    amount: float = Field(gt=0, description="Payment amount")
    currency: str
    reference_id: Optional[str] = None
    description: Optional[str] = None

class Payment(BaseModel):
    id: str
    amount: float
    currency: str
    status: str
    reference_id: Optional[str]
    created_at: str

class CheckoutSession(BaseModel):
    id: str
    url: str
    amount: float
    currency: str
    status: str
    expires_at: str

class MerchantBalance(BaseModel):
    available: Dict[str, float]
    pending: Dict[str, float]

class WebhookEvent(BaseModel):
    id: str
    type: str
    data: Dict[str, Any]
    created_at: str

class Pagination(BaseModel):
    has_more: bool
    next_cursor: Optional[str]
