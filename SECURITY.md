# Security Policy

## Supported version

Security reports should target the latest version on the repository's default branch.

## Reporting a vulnerability

Please do not publish credentials, exploit details, customer information, or other sensitive material in a public issue.

If GitHub private vulnerability reporting is enabled for this repository, use the repository's **Security → Report a vulnerability** flow. Otherwise, contact the repository maintainer privately through the contact method listed on the GitHub profile.

## Deployment guidance

- Keep `.env` and all secrets out of version control.
- Set a unique, high-entropy `SESSION_SECRET` for each deployment.
- Use a PostgreSQL connection string with certificate verification enabled.
- Use HTTPS and strong, unique admin passwords.
- Do not commit customer data, database files, receipts, or private support attachments.
