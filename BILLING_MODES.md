# Cursor Usage Extension - Billing Modes

## Overview

This extension now supports two billing modes for Cursor usage tracking:

### 1. USD-Based Billing (New)
- **API Endpoint**: `https://cursor.com/api/usage-summary`
- **Detection**: Automatically detected when `individualUsage.plan.limit > 0`
- **Display**: Shows usage in USD format (e.g., $11.16 / $20.00)

### 2. Request Count-Based Billing (Legacy)
- **API Endpoint**: `https://www.cursor.com/api/usage?user={user_id}`
- **Detection**: Used when USD billing is not available or limit is 0
- **Display**: Shows GPT-4 request count (e.g., GPT-4: 150)

## How It Works

1. Extension first tries to fetch data from the new `usage-summary` API
2. If `individualUsage.plan.limit` exists and is greater than 0:
   - Uses USD-based billing mode
   - Displays membership type and limit type
   - Shows billing cycle dates
   - Shows USD usage breakdown
3. Otherwise:
   - Falls back to legacy request count-based billing
   - Uses the old usage API
   - Shows request counts per model

## USD Billing Display

When in USD billing mode, the menu shows:
- **Type**: Membership type and limit type (e.g., "enterprise (team)")
- **Billing Cycle**: Start and end dates with progress
- **Plan Usage**: Used / Limit in USD with percentage
- **Breakdown**: Included, Bonus, and Total amounts
- **On-Demand**: If applicable

## Data Conversion

USD values in the API response are in cents (e.g., 1116 = $11.16).
The extension automatically divides by 100 for display.

## Example API Response

```json
{
    "billingCycleStart": "2025-10-09T10:21:54.000Z",
    "billingCycleEnd": "2025-11-09T10:21:54.000Z",
    "membershipType": "enterprise",
    "limitType": "team",
    "individualUsage": {
        "plan": {
            "used": 1116,
            "limit": 2000,
            "remaining": 884,
            "breakdown": {
                "included": 1116,
                "bonus": 0,
                "total": 1116
            }
        },
        "onDemand": {
            "used": 0,
            "limit": null,
            "remaining": null
        }
    }
}
```

