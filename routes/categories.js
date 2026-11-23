
const express = require("express");
const db = require("../database-postgres");

const router = express.Router();

// Get all active categories
router.get("/", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT id, name, description
            FROM categories
            WHERE active = 1
            ORDER BY name ASC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Categories fetch failed:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load categories."
        });
    }
});

module.exports = router;
