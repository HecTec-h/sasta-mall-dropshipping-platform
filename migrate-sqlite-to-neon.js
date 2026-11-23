
"use strict";

require("dotenv").config();

const Database = require("better-sqlite3");
const { Pool } = require("pg");
const path = require("path");

const TABLES = [
    "users",
    "admins",
    "categories",
    "products",
    "orders",
    "order_items",
    "order_item_tracking",
    "order_tracking_entries",
    "payment_settings",
    "product_media",
    "support_conversations",
    "support_messages"
];

const sqlitePath = path.join(__dirname, "database", "store.db");

const quoteIdentifier = (name) => {
    return '"' + name.replace(/"/g, '""') + '"';
};

async function migrate() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL missing from .env");
    }

    const sqlite = new Database(sqlitePath, {
        readonly: true,
        fileMustExist: true
    });

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    const client = await pool.connect();

    let transactionStarted = false;

    try {
        console.log("Checking source SQLite database...");

        const sourceTables = sqlite.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).all().map(row => row.name);

        for (const table of TABLES) {
            if (!sourceTables.includes(table)) {
                throw new Error("Source table missing: " + table);
            }
        }

        const sourceCounts = {};

        for (const table of TABLES) {
            sourceCounts[table] = sqlite
                .prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`)
                .get().total;
        }

        const totalSourceRecords = Object.values(sourceCounts)
            .reduce((sum, count) => sum + count, 0);

        console.log("Source records:", totalSourceRecords);

        console.log("Checking Neon schema...");

        for (const table of TABLES) {
            const result = await client.query(
                `SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                 AND table_name = $1`,
                [table]
            );

            if (result.rows.length === 0) {
                throw new Error("Neon table missing: " + table);
            }

            const targetColumns = new Set(
                result.rows.map(row => row.column_name)
            );

            const sourceColumns = sqlite.prepare(
                `PRAGMA table_info(${quoteIdentifier(table)})`
            ).all().map(column => column.name);

            for (const column of sourceColumns) {
                if (!targetColumns.has(column)) {
                    throw new Error(
                        `Column missing in Neon: ${table}.${column}`
                    );
                }
            }
        }

        console.log("Neon schema verified.");

        await client.query("BEGIN");
        transactionStarted = true;

        console.log("Checking that Neon tables are empty...");

        for (const table of TABLES) {
            const result = await client.query(
                `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(table)}`
            );

            if (result.rows[0].total !== 0) {
                throw new Error(
                    `Migration stopped: Neon table ${table} is not empty.`
                );
            }
        }

        console.log("All Neon tables are empty.");

        for (const table of TABLES) {
            const rows = sqlite.prepare(
                `SELECT * FROM ${quoteIdentifier(table)}`
            ).all();

            if (rows.length === 0) {
                console.log(`${table}: 0 records`);
                continue;
            }

            const columns = Object.keys(rows[0]);

            const columnSQL = columns
                .map(quoteIdentifier)
                .join(", ");

            const placeholders = columns
                .map((_, index) => `$${index + 1}`)
                .join(", ");

            const insertSQL =
                `INSERT INTO ${quoteIdentifier(table)}
                (${columnSQL})
                VALUES (${placeholders})`;

            const insert = client.query.bind(client);

            for (const row of rows) {
                const values = columns.map(column => row[column]);

                await insert(insertSQL, values);
            }

            console.log(`${table}: ${rows.length} records migrated`);
        }

        console.log("Updating PostgreSQL ID sequences...");

        for (const table of TABLES) {
            const sequenceResult = await client.query(
                "SELECT pg_get_serial_sequence($1, 'id') AS sequence",
                [`public.${table}`]
            );

            const sequence = sequenceResult.rows[0].sequence;

            if (sequence) {
                const maxResult = await client.query(
                    `SELECT MAX(id)::bigint AS max_id
                     FROM ${quoteIdentifier(table)}`
                );

                const maxId = maxResult.rows[0].max_id;

                if (maxId !== null) {
                    await client.query(
                        "SELECT setval($1::regclass, $2::bigint, true)",
                        [sequence, maxId]
                    );
                }
            }
        }

        console.log("Verifying migrated record counts...");

        let totalMigratedRecords = 0;

        for (const table of TABLES) {
            const result = await client.query(
                `SELECT COUNT(*)::int AS total
                 FROM ${quoteIdentifier(table)}`
            );

            const actual = result.rows[0].total;
            const expected = sourceCounts[table];

            if (actual !== expected) {
                throw new Error(
                    `Count mismatch in ${table}: expected ${expected}, got ${actual}`
                );
            }

            totalMigratedRecords += actual;

            console.log(`${table}: verified ${actual}`);
        }

        if (totalMigratedRecords !== totalSourceRecords) {
            throw new Error("Total record count mismatch.");
        }

        await client.query("COMMIT");
        transactionStarted = false;

        console.log("");
        console.log("==================================");
        console.log("MIGRATION SUCCESSFUL");
        console.log("Total records:", totalMigratedRecords);
        console.log("Tables migrated:", TABLES.length);
        console.log("SQLite database was not modified.");
        console.log("==================================");

    } catch (error) {
        if (transactionStarted) {
            await client.query("ROLLBACK");
            console.log("Neon transaction rolled back.");
        }

        throw error;

    } finally {
        client.release();
        sqlite.close();
        await pool.end();
    }
}

migrate().catch(error => {
    console.error("");
    console.error("MIGRATION FAILED:", error.message);
    process.exitCode = 1;
});
