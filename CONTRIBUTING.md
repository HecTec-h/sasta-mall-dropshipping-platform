# Contributing to Sasta Mall

Thank you for your interest in contributing.

## Before opening a pull request

1. Read the project README and follow the PostgreSQL setup instructions.
2. Check existing issues and pull requests to avoid duplicate work.
3. For significant changes, open an issue first to discuss the approach.

## Development workflow

1. Fork the repository and clone your fork.
2. Create a focused branch:

   ```bash
   git checkout -b feature/short-description
   ```

3. Install dependencies and configure a private `.env` file.
4. Make a focused change and test the affected customer and admin flows.
5. Document any PostgreSQL schema changes in `schema-postgres.sql`.
6. Commit with a clear message:

   ```bash
   git add .
   git commit -m "Describe the change"
   ```

7. Push your branch and open a pull request against `main`.

## Pull request checklist

- [ ] The change has a clear purpose and description.
- [ ] Customer and admin flows affected by the change have been tested.
- [ ] No `.env`, secrets, database dumps, customer records, receipts, or private uploads are included.
- [ ] Database changes are documented and safe for existing data.
- [ ] Screenshots are included for significant UI changes.

Please keep pull requests focused and avoid unrelated formatting changes.
