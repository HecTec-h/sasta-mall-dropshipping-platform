
const express = require("express");
const db = require("../database-postgres");
const { requireAdmin } = require("../middleware/admin-auth");

const router = express.Router();

function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function validId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// LIST CATEGORIES
router.get("/", requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                c.id,
                c.name,
                c.description,
                c.active,
                c.created_at,
                COUNT(p.id)::INTEGER AS product_count
            FROM categories c
            LEFT JOIN products p ON p.category_id = c.id
            GROUP BY c.id
            ORDER BY LOWER(c.name) ASC
        `);

        return res.json(result.rows);

    } catch (error) {
        console.error("Admin categories list failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not load categories."
        });
    }
});

// CREATE CATEGORY
router.post("/", requireAdmin, async (req, res) => {
    const name = cleanText(req.body?.name);
    const description = cleanText(req.body?.description);

    if (!name) {
        return res.status(400).json({
            success: false,
            message: "Category name is required."
        });
    }

    if (name.length > 100) {
        return res.status(400).json({
            success: false,
            message: "Category name must be 100 characters or fewer."
        });
    }

    if (description.length > 1000) {
        return res.status(400).json({
            success: false,
            message: "Description must be 1000 characters or fewer."
        });
    }

    try {
        const result = await db.query(`
            INSERT INTO categories (name, description, active)
            VALUES ($1, $2, 1)
            RETURNING id
        `, [name, description || null]);

        return res.status(201).json({
            success: true,
            message: "Category created successfully.",
            id: result.rows[0].id
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "A category with this name already exists."
            });
        }

        console.error("Admin category create failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not create category."
        });
    }
});

// UPDATE CATEGORY
router.put("/:id", requireAdmin, async (req, res) => {
    const id = validId(req.params.id);
    const name = cleanText(req.body?.name);
    const description = cleanText(req.body?.description);

    if (!id) {
        return res.status(400).json({
            success: false,
            message: "Invalid category ID."
        });
    }

    if (!name) {
        return res.status(400).json({
            success: false,
            message: "Category name is required."
        });
    }

    if (name.length > 100) {
        return res.status(400).json({
            success: false,
            message: "Category name must be 100 characters or fewer."
        });
    }

    if (description.length > 1000) {
        return res.status(400).json({
            success: false,
            message: "Description must be 1000 characters or fewer."
        });
    }

    try {
        const result = await db.query(`
            UPDATE categories
            SET name = $1, description = $2
            WHERE id = $3
        `, [name, description || null, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Category not found."
            });
        }

        return res.json({
            success: true,
            message: "Category updated successfully."
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "A category with this name already exists."
            });
        }

        console.error("Admin category update failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not update category."
        });
    }
});

// DELETE CATEGORY
router.delete("/:id", requireAdmin, async (req, res) => {
    const id = validId(req.params.id);

    if (!id) {
        return res.status(400).json({
            success: false,
            message: "Invalid category ID."
        });
    }

    try {
        const categoryResult = await db.query(`
            SELECT id, name
            FROM categories
            WHERE id = $1
        `, [id]);

        const category = categoryResult.rows[0];

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found."
            });
        }

        const usageResult = await db.query(`
            SELECT COUNT(*)::INTEGER AS count
            FROM products
            WHERE category_id = $1
        `, [id]);

        const productCount = usageResult.rows[0].count;

        if (productCount > 0) {
            return res.status(409).json({
                success: false,
                message: `Cannot delete "${category.name}" because ${productCount} product(s) use it. Reassign those products first; this protects your product and order records.`
            });
        }

        await db.query(`
            DELETE FROM categories
            WHERE id = $1
        `, [id]);

        return res.json({
            success: true,
            message: "Category deleted successfully."
        });

    } catch (error) {
        console.error("Admin category delete failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not delete category."
        });
    }
});

module.exports = router;
