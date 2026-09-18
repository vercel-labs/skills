---
name: python-hexagonal-architecture
description: Python project organization using Hexagonal Architecture (Ports & Adapters). Use when defining explicit domain boundaries, creating port interfaces with typing.Protocol, structuring business use cases, and decoupling Python applications from frameworks (FastAPI/Flask) and ORMs (SQLAlchemy/Tortoise).
---

# Python Hexagonal Architecture

Hexagonal architecture (Ports and Adapters) keeps Python business logic entirely independent from web frameworks, transport layers, database ORMs, and third-party SDKs. The core application depends on abstract ports, and infrastructure adapters implement those ports at the outer edges.

## When to Use This Skill

- Starting a complex Python project requiring long-term maintainability.
- Decoupling domain logic from heavy frameworks like FastAPI, Django, Flask, or SQLAlchemy.
- Supporting multiple entry points for the same business rule (e.g., an HTTP API, a Celery task, and a Click CLI).
- Swapping infrastructure components (e.g., migrating from PostgreSQL to MongoDB, or changing a notification provider) without modifying business rules.

## Core Concepts

* **Domain Model:** Pure business logic, entities, value objects, and domain exceptions. **Strict rule:** Zero external dependencies or framework imports (no Pydantic, no SQLAlchemy, no `requests`).
* **Use Cases (Application Layer):** Orchestrates domain behavior and coordinates workflows. It defines what the application *does*.
* **Inbound Ports:** `Protocol` classes defining how external drivers can trigger application behavior (typically use-case interfaces or service contracts).
* **Outbound Ports:** `Protocol` classes defining what the application needs from the outside world (e.g., `UserRepositoryPort`, `PaymentGatewayPort`). Adapters satisfy these structurally — no inheritance required.
* **Adapters:** Concrete implementations of ports at the application edges.
    * *Inbound Adapters:* FastAPI routers, CLI commands, AWS Lambda handlers.
    * *Outbound Adapters:* SQLAlchemy repositories, Stripe payment clients, Loguru loggers.
* **Composition Root:** The entry point of the application (`main.py` or a container module) where adapters are instantiated and manually injected into use cases.

## Dependency Direction

All arrows point **inward**. Outer layers depend on inner layers — never the reverse.

```
┌──────────────────────────────────────────────────────────────┐
│  Infrastructure Layer                                        │
│                                                              │
│  [Inbound Adapters]              [Outbound Adapters]         │
│  FastAPI, CLI, Lambda            SQLAlchemy, Stripe          │
└──────┬────────────────────────────────────┬──────────────────┘
       │ depends on                         │ implements
       ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│  Application Layer                                           │
│                                                              │
│  [Inbound Ports]                 [Outbound Ports]            │
│  Use-case Protocols              Repository / Gateway        │
│        │                         Protocols                   │
│        │ calls                        ▲                      │
│        ▼                              │ depends on           │
│  [Use Cases] ─────────────────────────┘                      │
│        │                                                     │
│        │ depends on                                          │
└────────┼─────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Domain Layer                                                │
│  Pure Python entities, value objects, domain exceptions      │
└──────────────────────────────────────────────────────────────┘
```

> **Key rule:** Outbound adapters (SQLAlchemy, Stripe) satisfy outbound ports structurally via `Protocol` — they never import from the application layer. The domain has zero outbound dependencies.

## Suggested Module Layout

```text
src/
└── ecommerce/
    ├── __init__.py
    └── orders/
        ├── __init__.py
        ├── domain/
        │   ├── __init__.py
        │   ├── exceptions.py
        │   └── models.py            # Pure Python dataclasses / classes
        ├── application/
        │   ├── __init__.py
        │   ├── ports/
        │   │   ├── __init__.py
        │   │   ├── inbound.py       # Use-case Protocol definitions
        │   │   └── outbound.py      # Repository / Gateway Protocols
        │   └── use_cases.py         # Pure orchestration logic
        ├── adapters/
        │   ├── __init__.py
        │   ├── inbound/
        │   │   ├── __init__.py
        │   │   └── fastapi_api.py   # FastAPI routes & Pydantic schemas
        │   └── outbound/
        │       ├── __init__.py
        │       ├── postgres_repo.py # Concrete SQLAlchemy repository
        │       └── stripe_gate.py   # Concrete Stripe gateway
        └── composition.py           # Dependency injection / factory functions
```

## Python Implementation Example

### 1. Domain Layer

Keep it isolated using Python's native `dataclasses`. No framework imports allowed here.

```python
# ecommerce/orders/domain/models.py
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Order:
    id: str
    amount_cents: int
    status: str
    authorization_id: Optional[str] = None

    @classmethod
    def create(cls, order_id: str, amount_cents: int) -> "Order":
        if amount_cents <= 0:
            raise ValueError("Amount must be greater than zero")
        return cls(id=order_id, amount_cents=amount_cents, status="PENDING")

    def mark_authorized(self, authorization_id: str) -> "Order":
        return Order(
            id=self.id,
            amount_cents=self.amount_cents,
            status="AUTHORIZED",
            authorization_id=authorization_id,
        )
```

### 2. Outbound Ports

Use `typing.Protocol` for structural subtyping. Adapters satisfy these contracts without importing or inheriting from them.

```python
# ecommerce/orders/application/ports/outbound.py
from typing import Optional, Protocol, runtime_checkable
from ecommerce.orders.domain.models import Order


@runtime_checkable
class OrderRepositoryPort(Protocol):
    def save(self, order: Order) -> None: ...
    def find_by_id(self, order_id: str) -> Optional[Order]: ...


@runtime_checkable
class PaymentGatewayPort(Protocol):
    def authorize(self, order_id: str, amount_cents: int) -> str:
        """Authorizes payment and returns an authorization ID."""
        ...
```

> `@runtime_checkable` is optional. Add it only if you need `isinstance()` checks at runtime (e.g., in tests). Without it, conformance is verified by the type checker alone.

### 3. Inbound Port

Defines the contract that inbound adapters use to trigger the use case.

```python
# ecommerce/orders/application/ports/inbound.py
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class CreateOrderCommand:
    order_id: str
    amount_cents: int


class CreateOrderInputPort(Protocol):
    def execute(self, command: CreateOrderCommand) -> dict[str, str]: ...
```

### 4. Application Use Case

Inject port `Protocol` types via the constructor. The use case is unaware of any concrete adapter.

```python
# ecommerce/orders/application/use_cases.py
from ecommerce.orders.application.ports.inbound import CreateOrderCommand
from ecommerce.orders.application.ports.outbound import (
    OrderRepositoryPort,
    PaymentGatewayPort,
)
from ecommerce.orders.domain.models import Order


class CreateOrderUseCase:
    def __init__(
        self,
        order_repository: OrderRepositoryPort,
        payment_gateway: PaymentGatewayPort,
    ) -> None:
        self.order_repository = order_repository
        self.payment_gateway = payment_gateway

    def execute(self, command: CreateOrderCommand) -> dict[str, str]:
        order = Order.create(
            order_id=command.order_id,
            amount_cents=command.amount_cents,
        )

        auth_id = self.payment_gateway.authorize(
            order_id=order.id,
            amount_cents=order.amount_cents,
        )

        authorized_order = order.mark_authorized(auth_id)
        self.order_repository.save(authorized_order)

        return {
            "order_id": authorized_order.id,
            "authorization_id": auth_id,
        }
```

### 5. Outbound Adapters

Concrete classes satisfy the `Protocol` structurally — **no import or inheritance from the port is needed**. The type checker verifies conformance at the injection site.

```python
# ecommerce/orders/adapters/outbound/postgres_repo.py
from typing import Optional
from sqlalchemy.orm import Session
from ecommerce.orders.domain.models import Order


class PostgresOrderRepository:
    """Satisfies OrderRepositoryPort structurally via Protocol."""

    def __init__(self, db_session: Session) -> None:
        self.session = db_session

    def save(self, order: Order) -> None:
        # self.session.add(ORMOrder.from_domain(order))
        # self.session.commit()
        pass

    def find_by_id(self, order_id: str) -> Optional[Order]:
        # row = self.session.query(ORMOrder).filter_by(id=order_id).first()
        # return row.to_domain() if row else None
        return None
```

```python
# ecommerce/orders/adapters/outbound/stripe_gate.py
import stripe
from ecommerce.orders.domain.models import Order


class StripePaymentGateway:
    """Satisfies PaymentGatewayPort structurally via Protocol."""

    def __init__(self, client: stripe.StripeClient) -> None:
        self.client = client

    def authorize(self, order_id: str, amount_cents: int) -> str:
        intent = self.client.payment_intents.create(
            params={
                "amount": amount_cents,
                "currency": "usd",
                "metadata": {"order_id": order_id},
            }
        )
        return intent.id
```

### 6. Composition Root

Wire all dependencies explicitly. This is the only place that imports from both the application and infrastructure layers simultaneously.

```python
# ecommerce/orders/composition.py
from sqlalchemy.orm import Session
import stripe

from ecommerce.orders.adapters.outbound.postgres_repo import PostgresOrderRepository
from ecommerce.orders.adapters.outbound.stripe_gate import StripePaymentGateway
from ecommerce.orders.application.ports.inbound import CreateOrderInputPort
from ecommerce.orders.application.use_cases import CreateOrderUseCase


def build_create_order_use_case(
    db_session: Session,
    stripe_client: stripe.StripeClient,
) -> CreateOrderInputPort:
    order_repository = PostgresOrderRepository(db_session=db_session)
    payment_gateway = StripePaymentGateway(client=stripe_client)

    return CreateOrderUseCase(
        order_repository=order_repository,
        payment_gateway=payment_gateway,
    )
```

### 7. Inbound Adapter

A FastAPI entrypoint that extracts transport objects and delegates to the composition root.

```python
# ecommerce/orders/adapters/inbound/schemas.py
from pydantic import BaseModel

class CreateOrderRequest(BaseModel):
    order_id: str
    amount_cents: int

class OrderResponse(BaseModel):
    order_id: str
    authorization_id: str
    status: str

```

```python
# ecommerce/orders/adapters/inbound/fastapi_api.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import stripe

from ecommerce.orders.adapters.inbound.schemas import CreateOrderRequest, OrderResponse
from ecommerce.orders.application.ports.inbound import (
    CreateOrderCommand,
    CreateOrderInputPort,
)
from ecommerce.orders.composition import build_create_order_use_case
from ecommerce.shared.dependencies import get_db, get_stripe_client

router = APIRouter()


class CreateOrderRequest(BaseModel):
    order_id: str
    amount_cents: int


@router.post("/orders")
def create_order(
    payload: CreateOrderRequest,
    db: Session = Depends(get_db),
    stripe_client: stripe.StripeClient = Depends(get_stripe_client),
) -> dict:
    try:
        use_case: CreateOrderInputPort = build_create_order_use_case(
            db_session=db,
            stripe_client=stripe_client,
        )

        command = CreateOrderCommand(
            order_id=payload.order_id,
            amount_cents=payload.amount_cents,
        )

        return use_case.execute(command)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
```

## ABC vs Protocol — When to Use Each

| | `typing.Protocol` | `abc.ABC` |
|---|---|---|
| Subtyping | Structural (duck typing) | Nominal (explicit inheritance) |
| Adapter imports port? | No | Yes |
| Missing method caught | By type checker | At instantiation (`TypeError`) |
| Pythonic style | ✅ Modern | ⚠️ Java-like |
| Runtime `isinstance` check | Opt-in via `@runtime_checkable` | Always available |
| Best for | New codebases, clean separation | Legacy code, stricter runtime guarantees |

## Anti-Patterns to Avoid

* **Leaking ORM Models:** Passing active record or SQLAlchemy models through use cases or the domain. This breaks isolation and risks lazy-loading errors out of context.
* **Decorating Domain with Frameworks:** Using `@app.post` or `@router` decorators directly on use-case methods, or applying Pydantic metadata inside domain classes.
* **Implicit Dependency Locators:** Relying on global variables or complex third-party injection frameworks that obscure where an implementation instance comes from.
* **Ports importing Adapters:** If a file inside `application/ports/` imports anything from `adapters/`, the dependency direction is inverted — this breaks the architecture.

## Testing Guidance

* **Domain unit tests:** Write standard `pytest` functions with zero mocks or setups. Test pure business edge conditions directly.
* **Use case unit tests:** Create lightweight fakes that satisfy the `Protocol` structurally — no mocking library needed:

```python
class FakeOrderRepository:
    def __init__(self) -> None:
        self.saved: list[Order] = []

    def save(self, order: Order) -> None:
        self.saved.append(order)

    def find_by_id(self, order_id: str) -> Optional[Order]:
        return next((o for o in self.saved if o.id == order_id), None)
```

* **Adapter integration tests:** Run separate pytest configurations leveraging Docker / Testcontainers to test real PostgreSQL migrations or external wire-mock network layouts.
