---
name: "📝 API/DB Feature Request"
about: Suggest a new backend API or database feature
title: "[Feature] <short description here>"
labels: [feature, backend]
assignees: ""
---

## ✨ API/Database Feature Request

### Summary

Describe the feature being requested. What functionality does it add to the backend or database? What problem does it solve?

## 📘 Use Case

Explain the use case behind this feature. Who is it for, and why is it needed now?

## 📥 Example API Request

```
POST /api/example-endpoint
Content-Type: application/json
Authorization: Bearer <token>

{
  "exampleField": "value",
  "anotherField": 123
}
```

## 📤 Example API Response

```
// JSON response
{
  "id": "abc123",
  "status": "success",
  "data": {
    "result": true,
    "timestamp": "2025-04-30T18:00:00Z"
  }
}
```

## 📦 Database Considerations

- **New Tables**: Yes/No
  If yes, describe the schema or include a rough layout.

- **Modified Tables**: Yes/No
  Describe what changes are needed and why.

- **Migrations Required**: Yes/No

- **Indexes Required**: Yes/No
  Include any thoughts on performance or query efficiency.

## 🔐 Security & Access Control

- Does the endpoint require authentication? Yes/No
- Should it be limited to specific roles (e.g. admin, worker, user)?
- Any sensitive data in the request or response?

## 📎 Additional Context

Add any screenshots, designs, relevant discussion links, or references to prior issues.
