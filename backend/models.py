from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

CATEGORIES = ["玩具", "服装", "饮料", "食品", "数码"]

class ProductBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    price: float = Field(..., gt=0)
    category: str = Field(...)

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    price: Optional[float] = Field(None, gt=0)
    category: Optional[str] = Field(None)

class ProductOut(ProductBase):
    id: int
    created: str
    updated: str

class ProductSearch(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    category: Optional[str] = None
    created_after: Optional[str] = None
    created_before: Optional[str] = None
    updated_after: Optional[str] = None
    updated_before: Optional[str] = None
