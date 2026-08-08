# Owner/Admin dashboard

The dashboard will be added after Supabase Auth roles, RLS, audit events, and the database
schema are in place. It will remain private to the Owner and Administrators; it is not a
customer-facing PWA in version 1. Its interface, validation messages, notifications, and audit
reason-code translations will be English-only in version 1.

Do not add a locale preference or language selector to Owner/Admin accounts in version 1.
`display_name` remains identity data and may use the administrator's own language; it is not
interface copy.
