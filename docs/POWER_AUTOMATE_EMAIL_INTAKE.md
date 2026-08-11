# Email Order Intake

Use Power Automate to monitor the shared orders mailbox and submit normalised orders to the existing staged-import API. The flow must not create planning orders directly; staging review remains the operational control gate.

## Flow

1. Trigger on a new email in the agreed shared mailbox.
2. Save the original email and attachment identifier in the flow audit history.
3. Extract order fields from the email body or attached Excel workbook.
4. For each order, call `POST /api/v1/staging` using a Microsoft Entra token with the `Tms.Access` delegated scope.
5. Route successful responses to the `Staging review` queue in the portal; route malformed rows to a planner exception notification.

## Request body

```json
{
  "entityType": "order",
  "idempotencyKey": "email:<message-id>:<row-number>",
  "source": "Power Automate / Orders Mailbox",
  "payload": {
    "poNumber": "PO-12345",
    "customerCode": "CUSTOMER-01",
    "collectionDate": "2026-08-11",
    "deliveryDate": "2026-08-12",
    "pallets": "12",
    "sellerName": "Seller name",
    "marketName": "Market name",
    "stallNumber": "A12",
    "driverInstructions": "Access and handling notes",
    "mapLink": "https://maps.example/..."
  }
}
```

Use the mailbox message ID plus row number as the idempotency key so forwarded or retried emails do not create duplicate orders.
