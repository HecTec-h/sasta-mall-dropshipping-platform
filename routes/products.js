
const express = require("express");
const db = require("../database-postgres");

const router = express.Router();

// Get active products
router.get("/", async (req, res) => {
    try {
        const categoryId = req.query.category;

        let query = `
            SELECT
                p.id,
                p.name,
                p.description,
                p.price,
                p.category_id,
                p.stock,
                (
                    SELECT file_path
                    FROM product_media
                    WHERE product_id = p.id
                    AND media_type = 'image'
                    ORDER BY sort_order ASC
                    LIMIT 1
                ) AS image
            FROM products p
            WHERE p.active = 1
        `;

        const params = [];

        if (categoryId) {
            query += ` AND p.category_id = $1`;
            params.push(categoryId);
        }

        query += ` ORDER BY p.created_at DESC`;

        const result = await db.query(query, params);

        res.json(result.rows);

    } catch (error) {
        console.error("Products fetch failed:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load products."
        });
    }
});

// Get single product with all media
router.get("/:id", async (req, res) => {
    try {
        const productResult = await db.query(`
            SELECT
                id,
                name,
                description,
                price,
                category_id,
                stock
            FROM products
            WHERE id = $1
            AND active = 1
        `, [req.params.id]);

        const product = productResult.rows[0];

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }

        const mediaResult = await db.query(`
            SELECT
                id,
                media_type,
                file_path,
                sort_order
            FROM product_media
            WHERE product_id = $1
            ORDER BY
                CASE WHEN media_type = 'video' THEN 0 ELSE 1 END,
                sort_order ASC
        `, [req.params.id]);

        res.json({
            ...product,
            media: mediaResult.rows
        });

    } catch (error) {
        console.error("Single product fetch failed:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load product."
        });
    }
});

module.exports = router;
