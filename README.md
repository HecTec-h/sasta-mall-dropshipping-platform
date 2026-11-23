# Sasta Mall — Dropshipping Platform

A full-stack dropshipping storefront and administration platform built with **Node.js, Express, PostgreSQL, and vanilla HTML/CSS/JavaScript**.

Sasta Mall includes a customer-facing storefront and an admin panel for managing products, categories, customers, orders, tracking, payment instructions, and customer support.

> **Project status:** The local PostgreSQL migration and the main customer/admin flows have been tested by the project maintainer. This repository is a self-hostable starting point; production deployment still requires secure environment configuration and persistent storage for uploaded media.

## Screenshots

### Storefront
![Sasta Mall home page](https://github.com/user-attachments/assets/9dc5db41-2545-4423-a9c9-45537ea32979)

### Product catalogue
![Sasta Mall product catalogue](https://github.com/user-attachments/assets/dd0c75a9-d57f-4008-84eb-48129947a811)

### Customer dashboard
![Sasta Mall customer dashboard](https://github.com/user-attachments/assets/f8d983e5-7d7e-4b43-b364-2e7ca56bb16b)

### Admin dashboard
![Sasta Mall admin dashboard](https://github.com/user-attachments/assets/c11e261a-322d-47ce-b9d0-30a77141480c)

### Customer support
![Sasta Mall customer support chat](https://github.com/user-attachments/assets/06d730f5-ac8c-44c0-9525-f94e1f37712d)

## Features

### Customer storefront
- Customer registration, login, and logout
- Product catalogue, categories, and product detail pages
- Product image/video support
- Shopping cart and checkout
- Customer dashboard and order history
- Order status and shipment tracking
- Configurable payment instructions
- Customer support chat with attachment support

### Admin panel
- Admin authentication and session-based access control
- Product and category management
- Customer and order management
- Order status and shipment tracking management
- Customer support conversation management and replies
- Payment method/instruction settings

### Platform and security
- PostgreSQL database integration (including Neon)
- PostgreSQL-backed Express sessions using `connect-pg-simple`
- Password hashing with `bcrypt`
- Environment-based configuration
- Parameterized PostgreSQL queries
- Private support attachment handling

## Technology stack

| Technology | Role |
|---|---|
| Node.js | Server runtime |
| Express 5 | HTTP server and API routes |
| PostgreSQL | Primary relational database |
| Neon | Hosted PostgreSQL option |
| `pg` | PostgreSQL client/pool |
| `connect-pg-simple` | Persistent session storage |
| `express-session` | Session-based authentication |
| `bcrypt` | Password hashing |
| `multer` | File upload handling |
| HTML, CSS, JavaScript | Customer and admin interfaces |

## Requirements

- Node.js 22 or newer
- npm
- A PostgreSQL database (Neon is supported)
- Git (for cloning)

Check your installed versions:

```bash
node --version
npm --version
```

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/Hectec-h/sasta-mall-dropshipping-platform.git
cd sasta-mall-dropshipping-platform
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a PostgreSQL database

Create a PostgreSQL database. [Neon](https://neon.tech/) can be used as a hosted option.

For a **new, empty database**, run the contents of [`schema-postgres.sql`](schema-postgres.sql) once using your database provider's SQL editor or `psql`.

**Important:** Do not run the schema file against an existing production database that already contains the Sasta Mall tables or customer data. Back up your database before any schema change.

The `user_sessions` table is created automatically by `connect-pg-simple` when the first session is saved.

### 4. Configure environment variables

Create your local environment file.

**Windows Command Prompt:**

```cmd
copy .env.example .env
```

**macOS/Linux:**

```bash
cp .env.example .env
```

Edit `.env` and set:

- `DATABASE_URL`: your PostgreSQL connection string. For Neon, use the connection string provided by Neon and ensure it includes `sslmode=verify-full`.
- `SESSION_SECRET`: a long, random, private value. Never commit or share it.
- `NODE_ENV`: use `development` locally and `production` on your production host.
- `PORT`: optional; defaults to `3000`.

Generate a session secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Do not paste the generated value into issues, chats, screenshots, or source files.

### 5. Create an admin account

For a **new installation** after the PostgreSQL schema is ready and `.env` is configured, run:

```bash
npm run admin:create
```

The script interactively asks for an admin username, display name, and password. It does not create a public default admin account.

If you are connecting this code to an **existing populated Sasta Mall database that already has an admin account**, skip account creation. To intentionally change an existing admin password:

```bash
npm run admin:reset
```

### 6. Start the application

```bash
npm start
```

Open:

- Storefront: <http://localhost:3000/>
- Admin login: <http://localhost:3000/admin/login.html>

If you configured a different `PORT`, use that port in the URLs.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Secret used to sign session cookies |
| `NODE_ENV` | Recommended | `development` or `production` |
| `PORT` | No | HTTP port; defaults to `3000` |

The application refuses to start in production if `SESSION_SECRET` is missing. In production, Express trusts one reverse proxy and session cookies are marked `secure`.

## Useful commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm start` | Start the application |
| `npm run admin:create` | Create an admin account in PostgreSQL |
| `npm run admin:reset` | Reset an admin password in PostgreSQL |
| `npm run db:migrate:sqlite-to-neon` | One-time legacy SQLite-to-PostgreSQL migration utility |

### Legacy SQLite migration utility

The optional `migrate-sqlite-to-neon.js` script is only for migrating a legacy SQLite database into a **completely empty** PostgreSQL database. It expects the source file at `database/store.db`, checks that the target tables are empty, and runs the import in a transaction.

The project maintainer has already completed the migration for the current Sasta Mall database. **Do not run this utility against the existing populated Neon database.** Keep a separate backup of the source SQLite database before any migration attempt.

## Project structure

```text
sasta-mall-dropshipping-platform/
├── admin/                  # Admin panel pages and scripts
├── middleware/             # Admin authentication middleware
├── public/                 # Storefront pages, styles, and browser scripts
├── routes/                 # Express API route modules
├── screenshots/            # Screenshot documentation
├── database-postgres.js    # PostgreSQL connection pool
├── schema-postgres.sql     # PostgreSQL schema for a new database
├── migrate-sqlite-to-neon.js # Optional one-time legacy migration
├── create-admin.js         # PostgreSQL admin creation utility
├── reset-admin-password.js # PostgreSQL admin password reset utility
├── server.js               # Express application entry point
├── .env.example            # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

## Uploaded files and deployment storage

The application currently writes uploaded product media, payment receipts, and support attachments to local filesystem paths.

- Existing public catalog media are retained in this repository so the current product catalogue can render. New runtime uploads, receipts, and private support files are not committed.
- A deployment platform with an ephemeral filesystem may delete newly uploaded files when an instance restarts or is redeployed.
- For production hosting, configure a persistent disk or integrate durable object storage for product media and uploaded files before relying on those files in production.
- Back up your PostgreSQL database and uploaded files regularly.

## Security checklist

Before deploying publicly:

- Set a new, unique `SESSION_SECRET` in the hosting provider's secret/environment settings.
- Keep `.env` out of Git; commit only `.env.example`.
- Use a PostgreSQL connection string with certificate verification (`sslmode=verify-full`).
- Create a unique admin account and use a strong password.
- Do not commit database dumps, customer information, receipts, private support attachments, or uploaded user files.
- Use HTTPS in production.
- Review hosting logs and database backups regularly.

See [SECURITY.md](SECURITY.md) for the security reporting policy.

## Contributing

Contributions, bug reports, and suggestions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Sasta Mall is released under the [MIT License](LICENSE).
