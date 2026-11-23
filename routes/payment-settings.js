
const express = require("express");
const db = require("../database-postgres");
const { requireAdmin } = require("../middleware/admin-auth");

const router = express.Router();

async function readSettings() {
    const result = await db.query(`
        SELECT
            method1_name,
            method1_number,
            method1_account_name,
            method2_name,
            method2_number,
            method2_account_name
        FROM payment_settings
        WHERE id = 1
    `);

    return result.rows[0] || {
        method1_name: "",
        method1_number: "",
        method1_account_name: "",
        method2_name: "",
        method2_number: "",
        method2_account_name: ""
    };
}

function getConfiguredMethods(settings) {
    const methods = [];

    for (const slot of [1, 2]) {
        const name = String(settings[`method${slot}_name`] || "").trim();
        const number = String(settings[`method${slot}_number`] || "").trim();
        const accountName = String(settings[`method${slot}_account_name`] || "").trim();

        if (name && number && accountName) {
            methods.push({ name, number, accountName });
        }
    }

    return methods;
}

// PUBLIC PAYMENT SETTINGS
router.get("/", async (req, res) => {
    try {
        const settings = await readSettings();

        res.json({
            success: true,
            methods: getConfiguredMethods(settings)
        });

    } catch (error) {
        console.error("Public payment settings error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load payment details."
        });
    }
});

// ADMIN: LOAD SETTINGS
router.get("/admin", requireAdmin, async (req, res) => {
    try {
        const settings = await readSettings();

        res.json({
            success: true,
            settings
        });

    } catch (error) {
        console.error("Admin payment settings load error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load payment settings."
        });
    }
});

// ADMIN: SAVE SETTINGS
router.put("/admin", requireAdmin, async (req, res) => {
    try {
        const fields = [
            "method1_name",
            "method1_number",
            "method1_account_name",
            "method2_name",
            "method2_number",
            "method2_account_name"
        ];

        const values = {};

        for (const field of fields) {
            const value = req.body[field] == null ? "" : req.body[field];

            if (typeof value !== "string" || value.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: "Payment fields must be text and no longer than 200 characters."
                });
            }

            values[field] = value.trim();
        }

        await db.query(`
            UPDATE payment_settings
            SET
                method1_name = $1,
                method1_number = $2,
                method1_account_name = $3,
                method2_name = $4,
                method2_number = $5,
                method2_account_name = $6,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `, [
            values.method1_name,
            values.method1_number,
            values.method1_account_name,
            values.method2_name,
            values.method2_number,
            values.method2_account_name
        ]);

        res.json({
            success: true,
            message: "Payment settings saved successfully."
        });

    } catch (error) {
        console.error("Admin payment settings save error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not save payment settings."
        });
    }
});

module.exports = router;
